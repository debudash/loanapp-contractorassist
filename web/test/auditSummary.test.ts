import { describe, expect, it } from "vitest";
import type { AuditTrail } from "../src/api";
import { checks, timeline } from "../src/auditSummary";

const pass = { pass: true, failures: [] };
const ok = { pass: true };
const turn = (fields: Record<string, unknown>) => ({
  id: 1, createdAt: "2026-10-28T10:06:00.000Z", message: "Why is the 20-year more?", outcome: "answered",
  renderedAnswer: "The 20-year costs $24,108.40 more in total.", renderedSay: "", rawDraft: [{}], guardResult: [pass],
  meaningCheck: [ok], models: { explain: "claude-sonnet-5-5" }, promptVersions: { explain: "explain@6" }, rulesVersion: "r7",
  inputTokens: 900, outputTokens: 80, latencyMs: 4100, ...fields,
});

const trail: AuditTrail = {
  session: { id: "s1", contractorId: "c_summit", startedAt: "2026-10-28T10:02:00.000Z", catalogVersion: "cat-2026-10" },
  consents: [{ id: 1, consentTextVersion: "r7", givenAt: "2026-10-28T10:04:00.000Z", homeownerName: "Maria Lopez" }],
  offerSets: [{ id: 1, consentId: 1, offerCount: 4, applicantRef: "moderate", amount: 30_000, budget: 300, quoteVersion: "quote@1", requestedAt: "2026-10-28T10:04:01.000Z", offers: [] }],
  turns: [
    turn({}),
    turn({
      id: 2, createdAt: "2026-10-28T10:07:00.000Z", message: "Is the promo basically free?", outcome: "standard_explanation",
      renderedAnswer: "Promo: …", guardResult: [{ pass: false, failures: [{ rule: "G-3", reason: "misleading marketing or pressure", quote: "free" }] }, pass],
      meaningCheck: [null, { pass: false, quote: "no interest", reason: "says a promo has no interest" }],
    }),
    turn({ id: 3, createdAt: "2026-10-28T10:08:00.000Z", message: "Will she qualify?", outcome: "redirected", renderedAnswer: "Approval and rates come from the lender.", rawDraft: [], guardResult: [], meaningCheck: [] }),
  ],
  escalations: [{ id: 1, turnId: 2, reason: "Both drafts failed", ticketRef: "JSM-12" }],
};

describe("compliance checks", () => {
  it("answers the reviewer's questions about the quote in plain words", () => {
    expect(checks(trail)).toEqual([
      { status: "ok", text: "Consent recorded before every soft check (1 of 1)" },
      { status: "ok", text: "1 AI answer shown, and it passed every check, so every figure in it came from the calculator" },
      { status: "warn", text: "2 drafts blocked; 1 question got the standard explanation instead (ticket JSM-12)" },
      { status: "ok", text: "1 question answered with compliance wording, not the model's" },
    ]);
  });

  it("flags a soft check with no consent before it", () => {
    const late = { ...trail, consents: [{ ...trail.consents[0]!, givenAt: "2026-10-28T10:05:00.000Z" }] };
    expect(checks(late)[0]).toEqual({ status: "fail", text: "Soft check without consent before it (0 of 1 had consent)" });
  });

  it("says when nothing has happened yet", () => {
    expect(checks({ ...trail, consents: [], offerSets: [], turns: [], escalations: [] })).toEqual([
      { status: "none", text: "No soft check run" },
      { status: "none", text: "No questions asked" },
    ]);
  });
});

describe("compliance timeline", () => {
  it("lists what happened in order, with each draft's checks", () => {
    const events = timeline(trail);

    expect(events.map((e) => e.title)).toEqual([
      "Quote started",
      "Consent given by Maria Lopez",
      "Soft check: 4 offers",
      "Q: Why is the 20-year more?",
      "Q: Is the promo basically free?",
      "Q: Will she qualify?",
    ]);
    expect(events[4]!.drafts).toEqual([
      { label: "Draft 1 blocked", blocked: true, checks: [{ name: "Numbers", ok: true }, { name: "Decisions", ok: true }, { name: "Marketing", ok: false, why: "\"free\": misleading marketing or pressure" }, { name: "Spoken disclosures", ok: true }, { name: "Meaning", ok: null }] },
      { label: "Draft 2 blocked", blocked: true, checks: [{ name: "Numbers", ok: true }, { name: "Decisions", ok: true }, { name: "Marketing", ok: true }, { name: "Spoken disclosures", ok: true }, { name: "Meaning", ok: false, why: "\"no interest\": says a promo has no interest" }] },
    ]);
    expect(events[4]!.outcome).toBe("Standard explanation shown · ticket JSM-12");
    expect(events[5]!.outcome).toBe("Compliance wording shown; the explaining model wasn't used");
  });

  // MR 9 standards review: a guard rule added on the server must still show as a failed check here.
  it("shows a failure from a guard rule it has no name for", () => {
    const newRule = { pass: false, failures: [{ rule: "G-5", reason: "something new", quote: "x" }] };
    const events = timeline({ ...trail, turns: [turn({ guardResult: [newRule], meaningCheck: [null] })] });

    expect(events.at(-1)!.drafts![0]!.checks).toContainEqual({ name: "G-5", ok: false, why: "\"x\": something new" });
  });
});

