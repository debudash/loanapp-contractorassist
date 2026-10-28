// Audit store: the service's own tables (docs/data-model.md), in SQLite via
// Node's built-in node:sqlite. Only inserts; the schema's triggers reject the rest.
import { createRequire } from "node:module";
import type { Offer } from "./domain.js";
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

export class AuditStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    // recursive_triggers makes INSERT OR REPLACE fire the delete trigger too.
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;");
    this.db.exec(SCHEMA);
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

  recordConsent(sessionId: string, consentTextVersion: string): number {
    const result = this.db
      .prepare("INSERT INTO consent (session_id, kind, consent_text_version, given_at) VALUES (?, 'soft_check', ?, ?)")
      .run(sessionId, consentTextVersion, now());
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

  /** Everything recorded for one session, for the compliance view (FR-15). */
  sessionTrail(sessionId: string) {
    const session = this.one("SELECT * FROM session WHERE id = ?", sessionId);
    const consents = this.many("SELECT * FROM consent WHERE session_id = ? ORDER BY id", sessionId);
    const offerSets = this.many("SELECT * FROM offer_set WHERE session_id = ? ORDER BY id", sessionId);
    return {
      session: session ? camel(session) : null,
      consents: consents.map(camel),
      offerSets: offerSets.map((set) => ({
        ...camel(set),
        offers: this.many("SELECT * FROM offer WHERE offer_set_id = ? ORDER BY id", set.id as number).map(camel),
      })),
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

/** Row keys from snake_case columns to camelCase for the API. */
function camel(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), v]));
}
