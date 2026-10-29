// Audit store: the service's own tables (docs/data-model.md), in SQLite via
// Node's built-in node:sqlite. Only inserts; the schema's triggers reject the rest.
import { createRequire } from "node:module";
import type { Offer } from "./domain.js";
import { presentOffers } from "./quote.js";
import { SCHEMA } from "./schema.js";

// Loaded with require because the test runner (Vitest 2) can't resolve
// prefix-only built-ins such as node:sqlite through a normal import.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, unknown>;
type SqlValue = string | number | null;

export interface OfferSetRecord {
  amount: number;
  budget?: number;
  applicantRef: string;
  catalogVersion: string;
  quoteVersion: string;
}

export type TurnOutcome = "suggested" | "answered" | "standard_explanation" | "redirected" | "unavailable" | "rate_limited";

/** One contractor message and everything that happened to it (FR-14). Drafts, guard results and verdicts hold one entry per attempt. */
export interface TurnRecord {
  sessionId: string;
  contractorId: string;
  offerSetId: number | null;
  catalogVersion: string;
  message: string;
  route: "inputs" | "question";
  outcome: TurnOutcome;
  offersOnScreen: string[];
  models: Record<string, string> | null;
  promptVersions: Record<string, string> | null;
  rulesVersion: string | null;
  rawDraft: unknown[];
  guardResult: unknown[];
  meaningCheck: unknown[];
  attempts: number;
  renderedAnswer: string | null;
  renderedSay: string | null;
  suggestedInputs: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** A turn with only who, where and what filled in; callers add what happened. */
export function blankTurn(
  fields: Pick<TurnRecord, "sessionId" | "contractorId" | "catalogVersion" | "message" | "route" | "outcome">,
): TurnRecord {
  return {
    offerSetId: null,
    offersOnScreen: [],
    models: null,
    promptVersions: null,
    rulesVersion: null,
    rawDraft: [],
    guardResult: [],
    meaningCheck: [],
    attempts: 0,
    renderedAnswer: null,
    renderedSay: null,
    suggestedInputs: null,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    ...fields,
  };
}

// Columns stored as JSON text; kept beside the schema's assistant_turn table.
const JSON_COLUMNS = ["offers_on_screen", "models", "prompt_versions", "raw_draft", "guard_result", "meaning_check", "suggested_inputs"];

export class AuditStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // recursive_triggers makes INSERT OR REPLACE fire the delete trigger too.
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;");
    this.db.exec(SCHEMA);
    // Audit databases made before the homeowner's name was kept get the column; old rows stay as they were.
    if (!this.many("PRAGMA table_info(consent)").some((c) => c.name === "homeowner_name")) {
      this.db.exec("ALTER TABLE consent ADD COLUMN homeowner_name TEXT");
    }
  }

  createSession(sessionId: string, contractorId: string, catalogVersion: string): void {
    this.db
      .prepare("INSERT INTO session (id, contractor_id, started_at, catalog_version) VALUES (?, ?, ?, ?)")
      .run(sessionId, contractorId, now(), catalogVersion);
  }

  /** The contractor who owns the session, or undefined if there is no such session. */
  sessionOwner(sessionId: string): string | undefined {
    return this.one("SELECT contractor_id FROM session WHERE id = ?", sessionId)?.contractor_id as string | undefined;
  }

  /** The homeowner's name is kept here and on screen only; it's never sent to the model. */
  recordConsent(sessionId: string, consentTextVersion: string, homeownerName: string): number {
    const result = this.db
      .prepare(
        "INSERT INTO consent (session_id, kind, consent_text_version, given_at, homeowner_name) VALUES (?, 'soft_check', ?, ?, ?)",
      )
      .run(sessionId, consentTextVersion, now(), homeownerName);
    return Number(result.lastInsertRowid);
  }

  /** Stores the engine's decision exactly as returned, in one transaction, linked to the consent that allowed it. */
  recordOfferSet(sessionId: string, consentId: number, record: OfferSetRecord, offers: Offer[]): number {
    this.db.exec("BEGIN");
    try {
      const set = this.db
        .prepare(
          `INSERT INTO offer_set (session_id, consent_id, amount, budget, applicant_ref, offer_count,
                                  catalog_version, quote_version, requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, consentId, record.amount, record.budget ?? null, record.applicantRef, offers.length,
             record.catalogVersion, record.quoteVersion, now());
      const offerSetId = Number(set.lastInsertRowid);
      const insertOffer = this.db.prepare(
        `INSERT INTO offer (offer_set_id, id, kind, amount, apr_percent, term_months, promo_months)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const o of offers) {
        const promoMonths = o.kind === "deferred_interest" ? o.promoMonths : null;
        insertOffer.run(offerSetId, o.id, o.kind, o.amount, o.aprPercent, o.termMonths, promoMonths);
      }
      this.db.exec("COMMIT");
      return offerSetId;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The most recent soft check in the session. */
  latestOfferSet(sessionId: string): { id: number; budget?: number; offers: Offer[] } | undefined {
    const set = this.one("SELECT id FROM offer_set WHERE session_id = ? ORDER BY id DESC LIMIT 1", sessionId);
    return set ? this.offerSet(sessionId, set.id as number) : undefined;
  }

  /** One soft check in the session, or undefined if it isn't this session's. */
  offerSet(sessionId: string, offerSetId: number): { id: number; budget?: number; offers: Offer[] } | undefined {
    const set = this.one("SELECT id, budget FROM offer_set WHERE session_id = ? AND id = ?", sessionId, offerSetId);
    if (!set) return undefined;
    const offers = this.many("SELECT * FROM offer WHERE offer_set_id = ? ORDER BY id", set.id as number).map(toOffer);
    return { id: set.id as number, ...(set.budget !== null && { budget: set.budget as number }), offers };
  }

  recordTurn(turn: TurnRecord): number {
    const json = (value: unknown) => JSON.stringify(value ?? null);
    const result = this.db
      .prepare(
        `INSERT INTO assistant_turn (session_id, contractor_id, offer_set_id, catalog_version, created_at, message, route,
           outcome, offers_on_screen, models, prompt_versions, rules_version, raw_draft, guard_result, meaning_check,
           attempts, rendered_answer, rendered_say, suggested_inputs, input_tokens, output_tokens, latency_ms)
         VALUES ($sessionId, $contractorId, $offerSetId, $catalogVersion, $createdAt, $message, $route,
           $outcome, $offersOnScreen, $models, $promptVersions, $rulesVersion, $rawDraft, $guardResult, $meaningCheck,
           $attempts, $renderedAnswer, $renderedSay, $suggestedInputs, $inputTokens, $outputTokens, $latencyMs)`,
      )
      .run({
        $sessionId: turn.sessionId,
        $contractorId: turn.contractorId,
        $offerSetId: turn.offerSetId,
        $catalogVersion: turn.catalogVersion,
        $createdAt: now(),
        $message: turn.message,
        $route: turn.route,
        $outcome: turn.outcome,
        $offersOnScreen: json(turn.offersOnScreen),
        $models: json(turn.models),
        $promptVersions: json(turn.promptVersions),
        $rulesVersion: turn.rulesVersion,
        $rawDraft: json(turn.rawDraft),
        $guardResult: json(turn.guardResult),
        $meaningCheck: json(turn.meaningCheck),
        $attempts: turn.attempts,
        $renderedAnswer: turn.renderedAnswer,
        $renderedSay: turn.renderedSay,
        $suggestedInputs: json(turn.suggestedInputs),
        $inputTokens: turn.inputTokens,
        $outputTokens: turn.outputTokens,
        $latencyMs: turn.latencyMs,
      });
    return Number(result.lastInsertRowid);
  }

  recordEscalation(turnId: number, reason: string, ticketRef: string | null): void {
    this.db
      .prepare("INSERT INTO escalation (turn_id, reason, created_at, ticket_ref) VALUES (?, ?, ?, ?)")
      .run(turnId, reason, now(), ticketRef);
  }

  /** Turns this contractor has had since the given time, not counting ones refused by the rate limit (FR-17). */
  turnsSince(contractorId: string, sinceIso: string): number {
    const row = this.one(
      "SELECT COUNT(*) AS n FROM assistant_turn WHERE contractor_id = ? AND created_at >= ? AND outcome <> 'rate_limited'",
      contractorId,
      sinceIso,
    );
    return Number(row?.n ?? 0);
  }

  /** Records a question refused by the rate limit, with the offers that were on screen (FR-14). */
  recordRateLimited(fields: Pick<TurnRecord, "sessionId" | "contractorId" | "catalogVersion" | "message">): void {
    const offerSet = this.latestOfferSet(fields.sessionId);
    this.recordTurn({
      ...blankTurn({ ...fields, route: "question", outcome: "rate_limited" }),
      offerSetId: offerSet?.id ?? null,
      offersOnScreen: offerSet ? presentOffers(offerSet.offers, offerSet.budget).cards.map((c) => c.offerId) : [],
    });
  }

  /** A trivial query, so the health check fails if the database is unreachable. */
  ping(): void {
    this.one("SELECT 1");
  }

  /**
   * The last answered questions about these offers, oldest first, for conversation history.
   * Answers are the model's own placeholder drafts, never rendered figures.
   */
  recentDrafts(sessionId: string, offerSetId: number | null, limit: number): { question: string; answer: string }[] {
    return this.many(
      `SELECT message, raw_draft FROM assistant_turn
       WHERE session_id = ? AND offer_set_id IS ? AND outcome = 'answered' ORDER BY id DESC LIMIT ?`,
      sessionId,
      offerSetId,
      limit,
    )
      .reverse()
      .map((t) => {
        const drafts = JSON.parse(t.raw_draft as string) as { answer: string }[];
        return { question: t.message as string, answer: drafts[drafts.length - 1]!.answer };
      });
  }

  /** Everything recorded for one session, for the compliance view (FR-15). */
  sessionTrail(sessionId: string) {
    const session = this.one("SELECT * FROM session WHERE id = ?", sessionId);
    const consents = this.many("SELECT * FROM consent WHERE session_id = ? ORDER BY id", sessionId);
    const offerSets = this.many("SELECT * FROM offer_set WHERE session_id = ? ORDER BY id", sessionId);
    const turns = this.many("SELECT * FROM assistant_turn WHERE session_id = ? ORDER BY id", sessionId);
    const escalations = this.many(
      "SELECT e.* FROM escalation e JOIN assistant_turn t ON t.id = e.turn_id WHERE t.session_id = ? ORDER BY e.id",
      sessionId,
    );
    return {
      session: session ? camel(session) : null,
      consents: consents.map(camel),
      offerSets: offerSets.map((set) => ({
        ...camel(set),
        offers: this.many("SELECT * FROM offer WHERE offer_set_id = ? ORDER BY id", set.id as number).map(camel),
      })),
      turns: turns.map((t) => camel(parseJsonColumns(t))),
      escalations: escalations.map(camel),
    };
  }

  private one(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private many(sql: string, ...params: SqlValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
}

function now(): string {
  return new Date().toISOString();
}

function toOffer(row: Row): Offer {
  const base = {
    id: row.id as string,
    amount: row.amount as number,
    aprPercent: row.apr_percent as number,
    termMonths: row.term_months as number,
  };
  return row.kind === "deferred_interest"
    ? { ...base, kind: "deferred_interest", promoMonths: row.promo_months as number }
    : { ...base, kind: "fixed" };
}

function parseJsonColumns(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, JSON_COLUMNS.includes(k) && typeof v === "string" ? JSON.parse(v) : v]),
  );
}

/** Row keys from snake_case columns to camelCase for the API. */
function camel(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), v]));
}
