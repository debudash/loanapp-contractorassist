import { describe, expect, it } from "vitest";
import rules from "../src/compliance-rules.json" with { type: "json" };
import { EXPLAIN_SYSTEM, explainPrompt, MEANING_CHECK_SYSTEM } from "../src/prompts.js";
import { figures, presentOffers } from "../src/quote.js";

const cards = presentOffers(
  [
    { kind: "fixed", id: "o-10y", amount: 30_000, aprPercent: 8.99, termMonths: 120 },
    { kind: "fixed", id: "o-20y", amount: 30_000, aprPercent: 9.99, termMonths: 240 },
    { kind: "deferred_interest", id: "o-promo", amount: 30_000, aprPercent: 15.99, termMonths: 180, promoMonths: 12 },
  ],
  300,
).cards;
const request = { question: "Compare cards 1 and 2", cards, figures: figures(cards, 300), termsTexts: ["Fixed rate: no penalty for paying early."], history: [], retryReasons: [] };
const banned = rules.phraseRules.flatMap((r) => r.phrases);
const wordsIn = (text: string) => banned.filter((p) => new RegExp(`(?<![\\w-])${p}(?![\\w-])`, "i").test(text));

describe("explain prompt", () => {
  // ISS-1: found by the first live eval run; the prompt's own words ("approved terms",
  // numbered cards) led the model to write words the guard then blocked.
  it("never uses a word the guard blocks, outside the rule that lists them", () => {
    const systemWithoutBannedList = EXPLAIN_SYSTEM.split("\n").filter((line) => !line.startsWith("6.")).join("\n");

    expect(wordsIn(systemWithoutBannedList)).toEqual([]);
    expect(wordsIn(explainPrompt(request))).toEqual([]);
  });

  it("lists cards by name, without numbers the model would copy", () => {
    const cardList = explainPrompt(request).split("\n\n")[0]!;

    expect(cardList).not.toMatch(/\d/);
  });

  it("tells the model to name offers instead of numbering or counting them", () => {
    expect(EXPLAIN_SYSTEM).toContain("Refer to offers by their names");
  });

  // ISS-5: found by the first live eval run; "costs more overall than a shorter term" wasn't
  // true of the shorter promo, which costs more.
  it("tells the model to compare named offers, not to generalise about terms", () => {
    expect(EXPLAIN_SYSTEM).toContain("Compare specific offers by name");
  });
});

describe("meaning check prompt", () => {
  // ISS-2: found by the first live eval run; the meaning check failed "no penalty for paying
  // early" as unsupported, a factual call outside its job (it never sees the terms text).
  it("judges only decisions, steering, marketing and advice, not factual accuracy", () => {
    expect(MEANING_CHECK_SYSTEM).toContain("Don't judge whether facts are accurate");
  });
});
