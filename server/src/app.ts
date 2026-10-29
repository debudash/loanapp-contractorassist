// HTTP routes. Thin: each one checks identity and input, calls the quote engine
// or an adapter, records what happened, and returns the result.
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { type AssistDeps, assist } from "./assist.js";
import type { AuditStore } from "./audit.js";
import type { Model } from "./model.js";
import rulesFile from "./compliance-rules.json" with { type: "json" };
import type { DecisionEngine, LoanCatalog } from "./ports.js";
import { amountInRange, ballpark, LOAN_MAX, LOAN_MIN, presentOffers, QUOTE_VERSION } from "./quote.js";

export interface Deps {
  catalog: LoanCatalog;
  engine: DecisionEngine;
  audit: AuditStore;
  model: Model;
  escalate: AssistDeps["escalate"];
  deadlineMs?: AssistDeps["deadlineMs"];
  /** Questions per contractor (FR-17), and optionally one daily cap across all contractors. */
  limits?: { perHour: number; perDay: number; allPerDay?: number };
  /** The built web app, served by this service in the public deployment; nginx serves it locally. */
  staticDir?: string;
}

export const DEFAULT_LIMITS = { perHour: 30, perDay: 200 };

/**
 * Limits from RATE_LIMIT_PER_HOUR and RATE_LIMIT_PER_DAY, for a test instance such as the red-team
 * run's; anything missing or not a positive whole number keeps the default. RATE_LIMIT_ALL_PER_DAY
 * caps questions across all contractors (the public deployment); without it there is no such cap.
 */
export function limitsFromEnv(env: Record<string, string | undefined>): NonNullable<Deps["limits"]> {
  const whole = (value: string | undefined) => (value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined);
  const allPerDay = whole(env.RATE_LIMIT_ALL_PER_DAY);
  return {
    perHour: whole(env.RATE_LIMIT_PER_HOUR) ?? DEFAULT_LIMITS.perHour,
    perDay: whole(env.RATE_LIMIT_PER_DAY) ?? DEFAULT_LIMITS.perDay,
    ...(allPerDay !== undefined && { allPerDay }),
  };
}
const MAX_MESSAGE_LENGTH = 500;
const MAX_NAME_LENGTH = 100;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function createApp(deps: Deps) {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    deps.audit.ping(); // throws, so the check fails, if the audit store is unreachable
    res.json({ ok: true });
  });
  const api = express.Router();

  // The portal authenticates contractors upstream (PRD A-4) and passes their ID.
  api.use((req, res, next) => {
    const contractorId = req.header("x-contractor-id");
    if (!contractorId) {
      res.status(401).json({ error: "contractor_required" });
      return;
    }
    res.locals.contractorId = contractorId;
    next();
  });

  /** The session ID if it exists and belongs to this contractor; otherwise answers with 400, 404 or 403. */
  const ownedSession = (req: Request, res: Response): string | undefined => {
    const sessionId = req.params.id ?? req.body?.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") {
      res.status(400).json({ error: "session_required" });
      return undefined;
    }
    const owner = deps.audit.sessionOwner(sessionId);
    if (owner === undefined) res.status(404).json({ error: "session_not_found" });
    else if (owner !== res.locals.contractorId) res.status(403).json({ error: "session_not_yours" });
    else return sessionId;
    return undefined;
  };

  api.post("/sessions", (_req, res) => {
    const sessionId = randomUUID();
    deps.audit.createSession(sessionId, res.locals.contractorId, deps.catalog.version);
    res.status(201).json({ sessionId });
  });

  // FR-1, FR-2: no homeowner data, no AI.
  api.post("/ballpark", (req, res) => {
    if (!ownedSession(req, res)) return;
    const quote = parseQuote(req.body, res);
    if (quote) res.json(ballpark(quote, deps.catalog.productsFor(res.locals.contractorId)));
  });

  // FR-4 to FR-8: consent first, then the soft check, then three cards.
  api.post("/offers", async (req, res) => {
    const { applicantRef, consent } = req.body;
    if (consent?.given !== true || typeof consent.textVersion !== "string") {
      res.status(400).json({ error: "consent_required" });
      return;
    }
    // Who gave consent, for the audit trail. The decision engine and the model never get it.
    const homeownerName = typeof consent.homeownerName === "string" ? consent.homeownerName.trim() : "";
    if (homeownerName === "" || homeownerName.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: "homeowner_name_required" });
      return;
    }
    const sessionId = ownedSession(req, res);
    if (!sessionId) return;
    const quote = parseQuote(req.body, res);
    if (!quote) return;
    if (typeof applicantRef !== "string" || applicantRef === "") {
      res.status(400).json({ error: "applicant_required" });
      return;
    }

    // Consent is recorded even if the check then fails: it was given.
    const consentId = deps.audit.recordConsent(sessionId, consent.textVersion, homeownerName);
    let offers;
    try {
      offers = await deps.engine.softCheck({ applicantRef, amount: quote.amount });
    } catch {
      res.status(502).json({ error: "soft_check_unavailable" });
      return;
    }
    const offerSetId = deps.audit.recordOfferSet(sessionId, consentId, {
      ...quote,
      applicantRef,
      catalogVersion: deps.catalog.version,
      quoteVersion: QUOTE_VERSION,
    }, offers);

    const presented = presentOffers(offers, quote.budget);
    res.json(offers.length === 0
      ? { noOffers: true, message: rulesFile.uiWording.noOffersNotice, offerSetId, ...presented }
      : { noOffers: false, offerSetId, ...presented });
  });

  // FR-17: questions per contractor, counting those still in flight so parallel requests can't slip past.
  // In public, the contractor header is whatever the caller sends, so a cap across everyone bounds spend.
  const inFlight = new Map<string, number>();
  const limitReached = (contractorId: string): string | undefined => {
    const limits: NonNullable<Deps["limits"]> = deps.limits ?? DEFAULT_LIMITS;
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const allPending = [...inFlight.values()].reduce((sum, n) => sum + n, 0);
    if (limits.allPerDay !== undefined && deps.audit.allTurnsSince(ago(DAY_MS)) + allPending >= limits.allPerDay) {
      return "The assistant has reached today's limit for this demo. The cards and figures still work.";
    }
    const pending = inFlight.get(contractorId) ?? 0;
    const since = (ms: number) => deps.audit.turnsSince(contractorId, ago(ms));
    if (since(HOUR_MS) + pending >= limits.perHour || since(DAY_MS) + pending >= limits.perDay) {
      return "Question limit reached for now. The cards and figures still work.";
    }
    return undefined;
  };

  // FR-9 to FR-14: the assistant panel. Length-capped and rate-limited before any model call (FR-16, FR-17).
  api.post("/assist", async (req, res) => {
    const sessionId = ownedSession(req, res);
    if (!sessionId) return;
    const message = req.body?.message;
    if (typeof message !== "string" || message.trim() === "") {
      res.status(400).json({ error: "message_required" });
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: "message_too_long", max: MAX_MESSAGE_LENGTH });
      return;
    }
    // The offer set the screen shows: null once the inputs have changed. Must belong to this session.
    const offerSetId = req.body?.offerSetId;
    if (offerSetId !== undefined && offerSetId !== null && !deps.audit.offerSet(sessionId, Number(offerSetId))) {
      res.status(400).json({ error: "offer_set_not_found" });
      return;
    }
    const contractorId: string = res.locals.contractorId;
    const limited = limitReached(contractorId);
    if (limited) {
      deps.audit.recordRateLimited({ sessionId, contractorId, catalogVersion: deps.catalog.version, message });
      res.status(429).json({ error: "rate_limited", message: limited });
      return;
    }
    inFlight.set(contractorId, (inFlight.get(contractorId) ?? 0) + 1);
    try {
      const onScreen = offerSetId === undefined ? undefined : offerSetId === null ? null : Number(offerSetId);
      const question = { sessionId, contractorId, message, offerSetId: onScreen };
      if (!req.get("accept")?.includes("application/x-ndjson")) {
        res.json(await assist(question, deps));
        return;
      }
      // The UI asks for JSON lines: one per stage as it starts, then the result. nginx would
      // otherwise hold the lines back until the end.
      res.status(200).set({ "content-type": "application/x-ndjson", "x-accel-buffering": "no", "cache-control": "no-cache" });
      res.flushHeaders();
      const line = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
      line({ result: await assist(question, { ...deps, onStage: (stage) => line({ stage }) }) });
      res.end();
    } finally {
      inFlight.set(contractorId, inFlight.get(contractorId)! - 1);
    }
  });

  // The compliance-owned wording the UI shows, so no compliance copy lives in the UI.
  api.get("/wording", (_req, res) => {
    res.json({ version: rulesFile.version, fixedWording: rulesFile.fixedWording, uiWording: rulesFile.uiWording });
  });

  // FR-15: everything recorded for a session. Reading never creates anything.
  api.get("/sessions/:id/audit", (req, res) => {
    const sessionId = ownedSession(req, res);
    if (sessionId) res.json(deps.audit.sessionTrail(sessionId));
  });

  app.use("/api", api);

  // The public deployment serves the built web app too; any other page path gets index.html.
  if (deps.staticDir) {
    const dir = resolve(deps.staticDir);
    app.use(express.static(dir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => res.sendFile(join(dir, "index.html")));
  }

  // Errors answer in JSON like the rest of the API, never Express's HTML page.
  app.use((error: { type?: string }, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.error(error);
    // A streamed answer has already sent its status: end it with an error line instead.
    if (res.headersSent) {
      res.end(`${JSON.stringify({ error: "internal_error" })}\n`);
      return;
    }
    res.status(500).json({ error: "internal_error" });
  });
  return app;
}

/** Amount and optional budget from a request body; answers with 400 and returns undefined if either is bad. */
function parseQuote(body: { amount?: unknown; budget?: unknown }, res: Response): { amount: number; budget?: number } | undefined {
  const amount = Number(body.amount);
  if (!amountInRange(amount)) {
    res.status(400).json({ error: "amount_out_of_range", min: LOAN_MIN, max: LOAN_MAX });
    return undefined;
  }
  if (body.budget === undefined || body.budget === null || body.budget === "") return { amount };
  const budget = Number(body.budget);
  if (!(budget > 0)) {
    res.status(400).json({ error: "invalid_budget" });
    return undefined;
  }
  return { amount, budget };
}
