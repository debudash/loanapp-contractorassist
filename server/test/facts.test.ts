import { describe, expect, it } from "vitest";
import { screenFacts, shownForJudge } from "../evals/facts.js";
import { figures, presentOffers } from "../src/quote.js";

const cards = presentOffers(
  [
    { kind: "fixed", id: "o-20y", amount: 30_000, aprPercent: 9.99, termMonths: 240 },
    { kind: "deferred_interest", id: "o-promo", amount: 30_000, aprPercent: 15.99, termMonths: 180, promoMonths: 12 },
  ],
  300,
).cards;

describe("what the judges see", () => {
  // ISS-6: found by the first live eval run; the judge failed "your budget" in the line read
  // aloud, not knowing it is addressed to the homeowner.
  it("labels the answer to the contractor and the line read aloud to the homeowner", () => {
    const shown = shownForJudge({ kind: "answer", outcome: "answered", answer: "It's under her budget.", say: "It's under your budget." });

    expect(shown).toBe(
      "Answer to the contractor:\nIt's under her budget.\n\nLine the contractor reads aloud to the homeowner:\nIt's under your budget.",
    );
  });

  // ISS-6: the judge failed "the built-up interest is $4,409.69" because the facts listed only
  // "cliff $4,409.69" without saying what the cliff is.
  it("says what each figure means, including the cliff", () => {
    const facts = screenFacts(cards, figures(cards, 300), ["Fixed rate."]);

    expect(facts).toContain("deferred interest added if not paid off in time (the cliff) $4,409.69");
    expect(facts).toContain("monthly payment $289.31");
    expect(facts).toContain("Homeowner's monthly budget: $300.00");
  });
});

describe("judge facts completeness", () => {
  // Found by the MR 8 standards review: a figure missing from the meanings list would vanish
  // from what the judge sees.
  it("shows every figure on a card, even one with no description yet", () => {
    const facts = screenFacts(cards, { ...figures(cards, 300), "promo.new_figure": "$1.00" }, []);

    expect(facts).toContain("new_figure $1.00");
  });
});

describe("judge facts: product type", () => {
  // Found by eval run 3: the judge failed "both fixed-rate offers have no early-payment penalty"
  // as unsupported because the facts never said which offers are fixed-rate.
  it("says which offers are fixed-rate and which is the deferred-interest promo", () => {
    const facts = screenFacts(cards, figures(cards, 300), []);

    expect(facts).toContain("- Lowest total cost and lowest monthly (fixed rate):");
    expect(facts).toContain("- Promo (deferred-interest promo):");
  });
});
