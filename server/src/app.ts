// HTTP routes. Thin: each one checks identity and input, calls the quote engine
// or an adapter, records what happened, and returns the result.
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import type { AuditStore } from "./audit.js";
import type { DecisionEngine, LoanCatalog } from "./ports.js";
import { amountInRange, ballpark, LOAN_MAX, LOAN_MIN, presentOffers, QUOTE_VERSION } from "./quote.js";

export interface Deps {
  catalog: LoanCatalog;
  engine: DecisionEngine;
  audit: AuditStore;
}

const NO_OFFERS_MESSAGE =
  "No offers came back from this check. The lender will send the homeowner a notice explaining why.";

export function createApp(deps: Deps) {
  const app = express();
  app.use(express.json());
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
    const sessionId = ownedSession(req, res);
    if (!sessionId) return;
    const quote = parseQuote(req.body, res);
    if (!quote) return;
    if (typeof applicantRef !== "string" || applicantRef === "") {
      res.status(400).json({ error: "applicant_required" });
      return;
    }

    // Consent is recorded even if the check then fails: it was given.
    const consentId = deps.audit.recordConsent(sessionId, consent.textVersion);
    let offers;
    try {
      offers = await deps.engine.softCheck({ applicantRef, amount: quote.amount });
    } catch {
      res.status(502).json({ error: "soft_check_unavailable" });
      return;
    }
    deps.audit.recordOfferSet(sessionId, consentId, {
      ...quote,
      applicantRef,
      catalogVersion: deps.catalog.version,
      quoteVersion: QUOTE_VERSION,
    }, offers);

    const presented = presentOffers(offers, quote.budget);
    res.json(offers.length === 0 ? { noOffers: true, message: NO_OFFERS_MESSAGE, ...presented } : { noOffers: false, ...presented });
  });

  // FR-15: everything recorded for a session. Reading never creates anything.
  api.get("/sessions/:id/audit", (req, res) => {
    const sessionId = ownedSession(req, res);
    if (sessionId) res.json(deps.audit.sessionTrail(sessionId));
  });

  app.use("/api", api);
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
