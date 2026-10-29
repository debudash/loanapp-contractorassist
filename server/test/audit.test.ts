import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditStore } from "../src/audit.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("audit trail", () => {
  // The guarantee compliance relies on, checked against the database itself:
  // nothing recorded can be changed or removed, whoever connects.
  // Review fix (slice 3, spec S5): found by spec review; INSERT OR REPLACE slipped past the delete trigger.
  it.each([
    "UPDATE session SET contractor_id = 'someone_else'",
    "DELETE FROM session",
    "INSERT OR REPLACE INTO session (id, contractor_id, started_at, catalog_version) VALUES ('s1', 'x', 'now', 'v')",
  ])("is append-only: %s is rejected", (sql) => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "test.db");
    const audit = new AuditStore(path);
    audit.createSession("s1", "c_summit", "cat-2026-10");

    // Connect the way the service does (AuditStore turns recursive triggers on,
    // so INSERT OR REPLACE fires the delete trigger).
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA recursive_triggers = ON;");

    expect(() => raw.exec(sql)).toThrow(/append-only/);
  });

  // Slice 9: audit databases made before the homeowner's name was recorded still open and record it.
  it("adds the homeowner name to a consent table made before it existed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE consent (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL,
      consent_text_version TEXT NOT NULL, given_at TEXT NOT NULL)`);
    old.close();

    const audit = new AuditStore(path);
    audit.createSession("s1", "c_summit", "cat-2026-10");
    audit.recordConsent("s1", "v1", "Maria Lopez");

    expect(audit.sessionTrail("s1").consents[0]).toMatchObject({ homeownerName: "Maria Lopez" });
  });
});
