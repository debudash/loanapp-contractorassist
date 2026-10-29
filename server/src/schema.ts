// Audit trail tables owned by the assistant service (docs/data-model.md).
// Append-only: triggers reject every UPDATE and DELETE. Production uses the
// same tables in Postgres with a role that has no UPDATE or DELETE rights.

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS session (
  id              TEXT PRIMARY KEY,
  contractor_id   TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  catalog_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT NOT NULL REFERENCES session(id),
  kind                 TEXT NOT NULL CHECK (kind IN ('soft_check')),
  consent_text_version TEXT NOT NULL,
  given_at             TEXT NOT NULL,
  homeowner_name       TEXT -- who gave consent; NULL only on rows recorded before it was kept
);

CREATE TABLE IF NOT EXISTS offer_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES session(id),
  consent_id    INTEGER NOT NULL REFERENCES consent(id),
  amount        REAL NOT NULL,
  budget        REAL,
  applicant_ref TEXT NOT NULL,
  offer_count     INTEGER NOT NULL,
  catalog_version TEXT NOT NULL,
  quote_version   TEXT NOT NULL,
  requested_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offer (
  offer_set_id INTEGER NOT NULL REFERENCES offer_set(id),
  id           TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('fixed', 'deferred_interest')),
  amount       REAL NOT NULL,
  apr_percent  REAL NOT NULL,
  term_months  INTEGER NOT NULL,
  promo_months INTEGER,
  PRIMARY KEY (offer_set_id, id)
);

CREATE TABLE IF NOT EXISTS assistant_turn (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT NOT NULL REFERENCES session(id),
  contractor_id    TEXT NOT NULL,
  offer_set_id     INTEGER REFERENCES offer_set(id),
  catalog_version  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  message          TEXT NOT NULL,
  route            TEXT NOT NULL CHECK (route IN ('inputs', 'question')),
  outcome          TEXT NOT NULL CHECK (outcome IN
                     ('suggested', 'answered', 'standard_explanation', 'redirected', 'unavailable', 'rate_limited')),
  offers_on_screen TEXT NOT NULL,
  models           TEXT,
  prompt_versions  TEXT,
  rules_version    TEXT,
  raw_draft        TEXT,
  guard_result     TEXT,
  meaning_check    TEXT,
  attempts         INTEGER NOT NULL,
  rendered_answer  TEXT,
  rendered_say     TEXT,
  suggested_inputs TEXT,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  latency_ms       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS escalation (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id    INTEGER NOT NULL REFERENCES assistant_turn(id),
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ticket_ref TEXT
);

CREATE INDEX IF NOT EXISTS turn_by_contractor ON assistant_turn (contractor_id, created_at);
`;

// Every table gets the append-only triggers; the list comes from the DDL so none is missed.
const TABLES = [...TABLES_DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);

export const SCHEMA =
  TABLES_DDL +
  TABLES.map(
    (t) => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END;`,
  ).join("");
