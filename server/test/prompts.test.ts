import { describe, expect, it } from "vitest";
import rules from "../src/compliance-rules.json" with { type: "json" };
import { guard, NUMBER_WORDS } from "../src/guard.js";
import { EXPLAIN_SYSTEM, explainPrompt, MEANING_CHECK_SYSTEM, meaningCheckPrompt, UNDERSTAND_SYSTEM } from "../src/prompts.js";
import { FIGURE_MEANINGS, figureMeaning, figures, presentOffers } from "../src/quote.js";

const cards = presentOffers(
  [
    { kind: "fixed", id: "o-10y", amount: 30_000, aprPercent: 8.99, termMonths: 120 },
    { kind: "fixed", id: "o-20y", amount: 30_000, aprPercent: 9.99, termMonths: 240 },
    { kind: "deferred_interest", id: "o-promo", amount: 30_000, aprPercent: 15.99, termMonths: 180, promoMonths: 12 },
  ],
  300,
).cards;
const request = { question: "Compare cards 1 and 2", cards, figures: figures(cards, 300), termsTexts: ["Fixed rate: no penalty for paying early."], history: [], retryReasons: [] };

/**
 * Words the guard would block in this text, found by the guard itself. Only words count: the
 * prompt's own rule numbers and placeholders aren't text the model is asked to copy.
 */
function guardedWords(text: string): string[] {
  return guard({ answer: text, say: "" }, { figures: {}, promoOnScreen: true })
    .failures.filter((f) => f.reason !== "placeholder not on this screen" && /[a-z]/i.test(f.quote))
    .map((f) => f.quote);
}

describe("explain prompt", () => {
  // ISS-1: found by the first live eval run; the prompt's own words ("approved terms", card
  // numbers, counts) led the model to write words the guard blocks. Prompt check; the live
  // re-run (docs/EVALS.md, run 2) is the regression evidence.
  it("ISS-1: uses no word the guard blocks, apart from the rules that list them", () => {
    const listsRemoved = EXPLAIN_SYSTEM.replace(NUMBER_WORDS.join(", "), "")
      .replace(rules.phraseRules.flatMap((r) => r.phrases).map((p) => `"${p}"`).join(", "), "")
      .replace(/"\$" and "%"/, "");
    const cardHeader = explainPrompt(request).split("\n\n")[0]!;

    // MR 10 review: since ISS-7 the figure meanings are prompt text too.
    const meanings = Object.keys(figures(cards, 300)).map(figureMeaning).join(". ");

    expect(guardedWords(listsRemoved)).toEqual([]);
    expect(guardedWords(cardHeader)).toEqual([]);
    expect(guardedWords(meanings)).toEqual([]);
  });

  it("ISS-1: tells the model to name offers instead of numbering or counting them", () => {
    expect(EXPLAIN_SYSTEM).toContain("Refer to offers by their names");
  });

  // ISS-7: found by eval run 5; "$90.55 more" compared the promo using the Lowest total cost
  // difference. Prompt check; run 6 is the regression evidence.
  it("ISS-7: says what each figure means, and that a difference compares only the offers it names", () => {
    const prompt = explainPrompt(request);

    expect(prompt).toContain("{{diff.monthly}} = $90.55: how much more a month the lowest total cost offer is than the lowest monthly offer");
    expect(prompt).toContain("{{promo.cliff}} = $4,409.69: deferred interest added if not paid off in time (the cliff)");
    expect(EXPLAIN_SYSTEM).toContain("A difference figure compares only the offers its meaning names");
  });

  // ISS-8: found by eval run 5; "Its monthly payment is lower" followed sentences about Lowest
  // total cost, so Lowest monthly's figures read as Lowest total cost's. Prompt check; run 6 is
  // the regression evidence.
  it("ISS-8: tells the model to name the offer in every sentence that gives its figures", () => {
    expect(EXPLAIN_SYSTEM).toContain("Name the offer in every sentence that gives one of its figures");
  });

  // ISS-10: found by eval run 7; asked "What does APR mean?", the line read aloud promised "I can
  // pull up the lender's disclosure documents", which nothing on screen offers. Prompt check;
  // the next eval run is the regression evidence.
  it("ISS-10: keeps suggestions for the contractor out of the spoken line, and forbids promises the screen can't keep", () => {
    expect(EXPLAIN_SYSTEM).toContain("Put that suggestion in \"answer\" only");
    expect(EXPLAIN_SYSTEM).toContain("Never promise the homeowner a document, action or follow-up");
    expect(MEANING_CHECK_SYSTEM).toContain("promises the homeowner a document, action or follow-up");
  });

  // ISS-5: found by the first live eval run. Prompt check; run 2 is the regression evidence.
  it("ISS-5: tells the model to compare named offers, not to generalise about terms", () => {
    expect(EXPLAIN_SYSTEM).toContain("Compare specific offers by name");
  });
});

describe("meaning check prompt", () => {
  // ISS-2, corrected after the MR 8 spec review: the first fix told the meaning check to ignore
  // accuracy, leaving no runtime check against misleading claims. It now gets the official
  // terms and what each figure means, and fails drafts that contradict them.
  it("ISS-2: fails drafts that contradict the terms or misdescribe a figure, not wording style", () => {
    expect(MEANING_CHECK_SYSTEM).toContain("contradicts the official terms or describes a figure as something it isn't");
    expect(MEANING_CHECK_SYSTEM).not.toContain("Don't judge whether facts are accurate");
  });

  it("ISS-2: gives the check the official terms and what each figure means", () => {
    const prompt = meaningCheckPrompt({
      draft: { answer: "If not, {{promo.cliff}} is added.", say: "" },
      termsTexts: ["Deferred interest: built-up interest is added if not paid off."],
      figures: figures(cards, 300),
    });

    expect(prompt).toContain("Deferred interest: built-up interest is added if not paid off.");
    expect(prompt).toContain("{{promo.cliff}} = deferred interest added if not paid off in time (the cliff)");
  });
});

// Slice 9: found in the UI walkthrough; the prompts and wording assumed the homeowner is a woman.
// The banned-phrase lists may name "she" and "her": they say what the model must never write.
describe("wording about the homeowner", () => {
  const noBudget = { ...request, figures: figures(cards) };
  it.each([
    ["understand prompt", UNDERSTAND_SYSTEM],
    ["explain prompt", EXPLAIN_SYSTEM + explainPrompt(noBudget)],
    ["meaning check prompt", MEANING_CHECK_SYSTEM.replace(/Never use these phrases.*|uses any of these phrases:.*/g, "")],
    ["fixed wording", Object.values(rules.fixedWording).join(" ")],
    ["UI wording", Object.values(rules.uiWording).join(" ")],
    ["figure meanings", Object.values(FIGURE_MEANINGS).join(" ")],
  ])("doesn't assume a gender: %s", (_, text) => {
    expect(text.replace(/Never use these words or phrases:.*/g, "").match(/\b(she|her|hers|he|him|his)\b/gi)).toBeNull();
  });
});
