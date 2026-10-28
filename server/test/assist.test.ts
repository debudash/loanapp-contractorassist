import { beforeEach, describe, expect, it } from "vitest";
import { assist } from "../src/assist.js";
import { AuditStore } from "../src/audit.js";
import rules from "../src/compliance-rules.json" with { type: "json" };
import type { Draft } from "../src/guard.js";
import { mockCatalog } from "../src/mocks/catalog.js";
import { guard } from "../src/guard.js";
import { MockDecisionEngine } from "../src/mocks/decisionEngine.js";
import { explainPrompt } from "../src/prompts.js";
import { FakeModel, PASS } from "./fakeModel.js";

const goodDraft: Draft = {
  answer: "Only the {{lowest_monthly.term_years}}-year option is under her budget, at {{lowest_monthly.monthly}}.",
  say: "The {{lowest_monthly.term_years}}-year plan is {{lowest_monthly.monthly}} a month at {{lowest_monthly.apr}} APR.",
};
const question = { kind: "question" as const };

let audit: AuditStore;
let model: FakeModel;
let tickets: { turnId: number; reason: string }[];

async function softCheck(applicantRef: string, budget?: number) {
  const consentId = audit.recordConsent("s1", "soft-check-v1");
  const offers = await new MockDecisionEngine().softCheck({ applicantRef, amount: 30_000 });
  return audit.recordOfferSet("s1", consentId, { amount: 30_000, budget, applicantRef, catalogVersion: mockCatalog.version, quoteVersion: "quote@1" }, offers);
}

beforeEach(() => {
  audit = new AuditStore(":memory:");
  model = new FakeModel();
  tickets = [];
  audit.createSession("s1", "c_summit", mockCatalog.version);
});

const ask = (message: string, deadlineMs?: number) =>
  assist(
    { sessionId: "s1", contractorId: "c_summit", message },
    {
      model,
      audit,
      catalog: mockCatalog,
      escalate: (turnId, reason) => {
        tickets.push({ turnId, reason });
        return `JSM-STUB-${turnId}`;
      },
      ...(deadlineMs !== undefined && { deadlineMs }),
    },
  );
const turns = () => audit.sessionTrail("s1").turns;

describe("assist: new numbers in the chat (lane 1)", () => {
  it("suggests inputs for the contractor to apply, without running a quote", async () => {
    model.understandings.push({ kind: "inputs", inputs: { amount: 25_000, budget: 250, projectType: "roofing" } });

    const result = await ask("drop it to $25K, she can do 250");

    expect(result).toEqual({ kind: "suggestion", inputs: { amount: 25_000, budget: 250, projectType: "roofing" }, dropped: [] });
    expect(model.explainRequests).toEqual([]);
    expect(turns()[0]).toMatchObject({ route: "inputs", outcome: "suggested", message: "drop it to $25K, she can do 250" });
  });

  it("drops a number the model invented (G-5)", async () => {
    model.understandings.push({ kind: "inputs", inputs: { amount: 26_000 } });

    expect(await ask("drop it to $25K")).toMatchObject({ kind: "suggestion", dropped: ["amount"] });
  });
});

describe("assist: questions about the offers (lane 2)", () => {
  beforeEach(async () => {
    await softCheck("moderate", 300); // the $30,000 roof, $300 budget
  });

  it("answers with figures filled in by code, and records every step", async () => {
    model.understandings.push(question);
    model.drafts.push(goodDraft);
    model.verdicts.push(PASS);

    const result = await ask("Which one fits her budget?");

    expect(result).toEqual({
      kind: "answer",
      outcome: "answered",
      answer: "Only the 20-year option is under her budget, at $289.31.",
      say: "The 20-year plan is $289.31 a month at 9.99% APR.",
    });
    const request = model.explainRequests[0]!;
    expect(request.figures).toMatchObject({ "lowest_monthly.monthly": "$289.31", budget: "$300.00" });
    expect(request.termsTexts.some((t) => t.startsWith("Deferred interest"))).toBe(true);
    expect(turns()[0]).toMatchObject({
      route: "question",
      outcome: "answered",
      attempts: 1,
      rawDraft: [goodDraft],
      guardResult: [{ pass: true, failures: [] }],
      meaningCheck: [PASS],
      renderedAnswer: "Only the 20-year option is under her budget, at $289.31.",
      models: model.names,
      promptVersions: { understand: expect.any(String), explain: expect.any(String), check: expect.any(String) },
      offerSetId: expect.any(Number),
      inputTokens: 300, // three calls at 100 each
      outputTokens: 60,
    });
  });

  // Review fix (slice 4, spec S6): found by spec review; a successful retry lost the first draft.
  it("retries once with the guard's reasons, and records both attempts", async () => {
    const badDraft = { answer: "It's about $290 a month.", say: "" };
    model.understandings.push(question);
    model.drafts.push(badDraft, goodDraft);
    model.verdicts.push(PASS);

    const result = await ask("What's the monthly?");

    expect(result).toMatchObject({ kind: "answer", outcome: "answered" });
    expect(model.explainRequests[1]!.retryReasons.join(" ")).toContain("number written by the model");
    expect(turns()[0]).toMatchObject({ attempts: 2, rawDraft: [badDraft, goodDraft], meaningCheck: [null, PASS] });
  });

  it("still shows the standard explanation if raising the ticket fails", async () => {
    model.understandings.push(question);
    model.drafts.push({ answer: "Free!", say: "" }, { answer: "Free!", say: "" });
    const failingEscalation = () => {
      throw new Error("Zapier down");
    };

    const result = await assist({ sessionId: "s1", contractorId: "c_summit", message: "Is it free?" },
      { model, audit, catalog: mockCatalog, escalate: failingEscalation });

    expect(result).toMatchObject({ outcome: "standard_explanation" });
    expect(audit.sessionTrail("s1").escalations[0]).toMatchObject({ ticketRef: null });
  });

  it("shows a standard explanation written in code and raises a ticket naming both failures", async () => {
    const steer = { pass: false, quote: "under her budget", reason: "steers toward one offer" };
    model.understandings.push(question);
    model.drafts.push(goodDraft, { ...goodDraft, answer: "She's pre-approved." });
    model.verdicts.push(steer);

    const result = await ask("Which one is best?");

    expect(result).toMatchObject({ kind: "answer", outcome: "standard_explanation", say: "" });
    if (result.kind !== "answer") throw new Error("expected an answer");
    expect(result.answer).toContain("Lowest monthly: $289.31 a month for 20 years at 9.99% APR");
    expect(result.answer).toContain("$4,409.69");
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.reason).toContain("steers toward one offer");
    expect(tickets[0]!.reason).toContain("pre-approved");
    expect(audit.sessionTrail("s1").escalations[0]).toMatchObject({ ticketRef: `JSM-STUB-${tickets[0]!.turnId}` });
    expect(turns()[0]).toMatchObject({ attempts: 2, outcome: "standard_explanation" });
  });

  // Review fix (slice 4, spec S3): found by spec review; history fed rendered digits and older offers back.
  it("passes history as placeholder drafts from the current offers only", async () => {
    model.understandings.push(question, question, question);
    model.drafts.push(goodDraft, goodDraft, goodDraft);
    model.verdicts.push(PASS, PASS, PASS);
    await ask("Which one fits her budget?");
    await softCheck("strong", 300); // new offers on screen
    await ask("And now?");

    await ask("And the promo?");

    expect(model.explainRequests[1]!.history).toEqual([]);
    expect(model.explainRequests[2]!.history).toEqual([{ question: "And now?", answer: goodDraft.answer }]);
  });
});

describe("assist: fixed wording from the compliance rules", () => {
  // Review fix (slice 4, spec S1): found by spec review; redirect wording lived in code and assumed no offers.
  it.each([
    ["before offers", false, rules.fixedWording.creditDecisionBeforeOffers],
    ["after offers", true, rules.fixedWording.creditDecisionAfterOffers],
  ])("redirects a credit-decision question %s, without the explain model", async (_when, offersShown, wording) => {
    if (offersShown) await softCheck("moderate");
    model.understandings.push({ kind: "credit_decision" });

    const result = await ask("She's got a 780 score, she'll get approved right?");

    expect(result).toEqual({ kind: "answer", outcome: "redirected", answer: wording, say: "" });
    expect(model.explainRequests).toEqual([]);
    // Only the step that ran is recorded.
    expect(turns()[0]!.models).toEqual({ understand: "fake-haiku" });
    expect(Object.keys(turns()[0]!.promptVersions as object)).toEqual(["understand"]);
  });

  // Review fix (slice 4, spec re-review 1): found by spec re-review; after a decline, a credit
  // question got wording that promised offers.
  it("answers a credit question after a decline with the no-offers wording", async () => {
    await softCheck("no_offers");
    model.understandings.push({ kind: "credit_decision" });

    expect(await ask("Why didn't she qualify?")).toMatchObject({ answer: rules.fixedWording.noOffers });
  });

  // Review fix (slice 4, spec re-review 2): found by spec re-review; fixed wording was never checked.
  it.each(Object.entries(rules.fixedWording))("keeps the fixed wording itself within the rules: %s", (_name, wording) => {
    expect(guard({ answer: wording, say: "" }, { figures: {}, promoOnScreen: true }).failures).toEqual([]);
  });

  it("redirects an off-topic question", async () => {
    model.understandings.push({ kind: "off_topic" });

    expect(await ask("Does she get the solar tax credit?")).toMatchObject({ answer: rules.fixedWording.offTopic });
  });

  // Review fix (slice 4, spec S2): found by spec review; after a decline the model could guess why.
  it("answers any question after a decline with the no-offers wording, never the model's", async () => {
    await softCheck("no_offers");
    model.understandings.push(question);

    const result = await ask("Why didn't she get anything?");

    expect(result).toEqual({ kind: "answer", outcome: "redirected", answer: rules.fixedWording.noOffers, say: "" });
    expect(model.explainRequests).toEqual([]);
  });
});

describe("assist: when the model fails", () => {
  beforeEach(async () => {
    await softCheck("moderate");
  });

  it("says the assistant is unavailable, and records how far it got", async () => {
    model.understandings.push(question);
    model.failOn = "explain";

    const result = await ask("What's the promo?");

    expect(result).toEqual({
      kind: "unavailable",
      message: "The assistant is unavailable right now. The cards and figures on screen are unaffected.",
    });
    expect(turns()[0]).toMatchObject({ outcome: "unavailable", route: "question", attempts: 0 });
  });

  // Review fix (slice 4, spec S7): found by spec review; slow calls ran on and kept billing.
  it("gives up at the deadline and cancels the call", async () => {
    model.understandings.push(question);
    model.hangOn = "explain";

    expect(await ask("What's the promo?", 50)).toMatchObject({ kind: "unavailable" });
  });

  // Review fix (slice 4, standards T3 and spec re-review 3): a defect surfaces instead of being
  // reported as "unavailable", but the turn is still recorded.
  it("lets a defect surface, and still records the turn", async () => {
    model.understandings.push(question); // no draft scripted: the fake throws a plain Error

    await expect(ask("What's the promo?")).rejects.toThrow("nothing scripted");
    expect(turns()[0]).toMatchObject({ outcome: "unavailable" });
  });

  // Review fix (slice 4, spec re-review S6): found by spec re-review; a deadline during the meaning
  // check lost a draft that had already passed the rules.
  it("keeps a draft that passed the rules when the deadline hits during the meaning check", async () => {
    model.understandings.push(question);
    model.drafts.push(goodDraft);
    model.hangOn = "meaningCheck";

    await ask("What's the promo?", 50);

    expect(turns()[0]).toMatchObject({ outcome: "unavailable", attempts: 1, rawDraft: [goodDraft], meaningCheck: [null] });
  });
});

describe("explain prompt", () => {
  // Review fix (slice 4, spec re-review 4): found by spec re-review; with no budget the prompt
  // had no instruction and its own example used {{budget}}.
  it("tells the model to suggest asking about a budget when none was given", () => {
    const prompt = explainPrompt({ question: "Which is best?", cards: [], figures: {}, termsTexts: [], history: [], retryReasons: [] });

    expect(prompt).toContain("What monthly amount would feel comfortable?");
  });
});
