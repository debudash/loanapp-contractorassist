import { describe, expect, it } from "vitest";
import type { Offer } from "../src/domain.js";
import { guard } from "../src/guard.js";
import { figures, presentOffers } from "../src/quote.js";

// The $30,000 roof from slice 1: 10-year at 8.99%, 20-year at 9.99%, a 12-month promo, $300 budget.
const offers: Offer[] = [
  { kind: "fixed", id: "o-10y", amount: 30_000, aprPercent: 8.99, termMonths: 120 },
  { kind: "fixed", id: "o-20y", amount: 30_000, aprPercent: 9.99, termMonths: 240 },
  { kind: "deferred_interest", id: "o-promo", amount: 30_000, aprPercent: 15.99, termMonths: 180, promoMonths: 12 },
];
const screen = { figures: figures(presentOffers(offers, 300).cards), promoOnScreen: false };

const answer = (text: string) => ({ answer: text, say: "" });
const say = (text: string) => ({ answer: "", say: text });
const rulesFailed = (draft: { answer: string; say: string }, s = screen) => guard(draft, s).failures.map((f) => f.rule);

describe("guard", () => {
  it("passes a draft that uses only placeholders for numbers", () => {
    const draft = {
      answer: "Only the {{lowest_monthly.term_years}}-year option is under her budget.",
      say: "The {{lowest_monthly.term_years}}-year plan is {{lowest_monthly.monthly}} a month at {{lowest_monthly.apr}} APR.",
    };

    expect(guard(draft, screen)).toEqual({ pass: true, failures: [] });
  });

  describe("G-1: every number comes from code", () => {
    it("fails a digit the model wrote itself", () => {
      expect(guard(answer("That's about $290 a month."), screen).failures).toEqual([
        { rule: "G-1", reason: "number written by the model", quote: "$" },
        { rule: "G-1", reason: "number written by the model", quote: "290" },
      ]);
    });

    it.each([
      "It saves roughly twenty-four thousand dollars.",
      "It's one percent lower.",
      "There's zero down.",
      "That's a couple grand more.",
      "After a dozen payments it changes.",
      "Interest hits in the thirteenth month.",
      "It's about half the cost.",
      "That's ３００ a month.",
      "That's 9% lower.",
      "By the sixtieth payment it's different.",
      "The hundredth payment is smaller.",
      // Review fix (slice 4, spec S4): found by spec review; "${{x.monthly}}" rendered "$$289.31".
      "It's ${{lowest_monthly.monthly}} a month.",
    ])("fails a number slipped in as words or symbols: %s", (text) => {
      expect(rulesFailed(answer(text))).toContain("G-1");
    });

    it("allows 'one' as a pronoun", () => {
      expect(guard(answer("This one is under her budget."), screen).pass).toBe(true);
    });

    // Review fix (slice 2, spec S1): found by spec review; `in` accepted prototype keys.
    it.each(["{{promo.apr_2}}", "{{constructor}}", "{{__proto__}}"])("fails a placeholder not on this screen: %s", (p) => {
      expect(guard(answer(`It's ${p}.`), screen).failures).toEqual([
        { rule: "G-1", reason: "placeholder not on this screen", quote: p },
      ]);
    });

    // ISS-4: found by the first live eval run; "how much in total?" was answered with "about $69,000".
    it("keeps rounded figures to the spoken line; the answer uses exact figures", () => {
      expect(guard(answer("In total she'd pay {{lowest_monthly.total.rounded}}."), screen).failures).toEqual([
        { rule: "G-1", reason: "rounded figure outside the spoken line", quote: "{{lowest_monthly.total.rounded}}" },
      ]);
      expect(guard(say("In total she'd pay {{lowest_monthly.total.rounded}}."), screen).pass).toBe(true);
    });

    // ISS-3: found by the first live eval run; "about {{diff.total.rounded}}" rendered "about about $24,000".
    it("fails a rounded figure the model prefixed with 'about', which the figure already says", () => {
      expect(guard(say("It costs About  {{diff.total.rounded}} more."), screen).failures).toEqual([
        { rule: "G-1", reason: "rounded figure already says 'about'", quote: "About  {{diff.total.rounded}}" },
      ]);
    });

    // Review fix (slice 2, spec S2): found by spec review; malformed placeholders showed raw braces.
    it.each([
      "{{ lowest_monthly.monthly }}",
      "{{Lowest_Monthly.monthly}}",
      "{{lowest_monthly.monthly}",
      "{lowest_monthly.monthly}",
      "{{{lowest_monthly.monthly}}}",
      "{{lowest_monthly.monthly}}}",
    ])(
      "fails a malformed placeholder that would show raw braces: %s",
      (text) => {
        expect(rulesFailed(answer(`It's ${text}.`))).toContain("G-1");
      },
    );
  });

  describe("G-2: no credit decisions, no recommendations", () => {
    it.each([
      "She's pre-approved.",
      "I'd go with the cheaper monthly.",
      "I would recommend the longer term.",
      "You should take the promo.",
      "I’d recommend the shorter term.", // curly apostrophe
      "She should take the longer term.",
      "My recommendation is the shorter term.",
    ])("fails: %s", (text) => {
      expect(rulesFailed(answer(text))).toContain("G-2");
    });

    it.each(["Payments should go down if she pays early.", "The soft check should take a minute."])(
      "passes a factual sentence: %s",
      (text) => {
        expect(guard(answer(text), screen).pass).toBe(true);
      },
    );
  });

  describe("G-3: no misleading marketing or pressure", () => {
    it.each([
      "It's basically free.",
      "If she can stretch to the shorter term...",
      "It's the best\ndeal.",
      "Best  deal around.",
      "It's the best​deal.", // zero-width space
    ])(
      "fails: %s",
      (text) => {
        expect(rulesFailed(answer(text))).toContain("G-3");
      },
    );

    it.each(["Paying early is penalty-free.", "Lowest monthly isn't the cheapest overall.", "A longer term stretches the cost out."])(
      "passes a factual sentence: %s",
      (text) => {
        expect(guard(answer(text), screen).pass).toBe(true);
      },
    );

    it("fails 'no interest' only when a deferred-interest promo is on screen", () => {
      const draft = answer("There's no interest, no-interest, or no–interest for a year."); // en dash

      expect(guard(draft, screen).pass).toBe(true);
      expect(guard(draft, { ...screen, promoOnScreen: true }).failures.map((f) => f.quote)).toEqual([
        "no interest",
        "no-interest",
        "no-interest",
      ]);
    });
  });

  describe("G-4: a spoken payment comes with its disclosures", () => {
    it("fails a spoken payment without that offer's APR and term, but not one in the answer", () => {
      expect(guard(say("It's just {{lowest_monthly.monthly}} a month."), screen).failures).toEqual([
        { rule: "G-4", reason: "spoken payment without its APR and term", quote: "{{lowest_monthly.monthly}}" },
      ]);
      // The answer sits next to the card, which already shows every disclosure.
      expect(guard(answer("It's {{lowest_monthly.monthly}} a month."), screen).pass).toBe(true);
    });

    // Review fix (slice 2, spec S3): found by spec review; a monthly difference demanded an APR that can't exist.
    it("allows a spoken difference in monthly payment, which isn't an offer's payment", () => {
      expect(guard(say("It costs {{diff.monthly}} more a month."), screen).pass).toBe(true);
    });

    // Review fix (slice 2, spec S4): found by spec review; a promo payment could be said without its cliff.
    it("requires the cliff whenever a promo payment is said aloud", () => {
      const withoutCliff = say("The promo is {{promo.monthly}} a month for {{promo.term_years}} years at {{promo.apr}} APR.");
      const withCliff = say(`${withoutCliff.say} If it isn't paid off in {{promo.months}} months, {{promo.cliff}} is added.`);

      expect(guard(withoutCliff, screen).failures).toEqual([
        { rule: "G-4", reason: "spoken promo payment without its cliff", quote: "{{promo.monthly}}" },
      ]);
      expect(guard(withCliff, screen).pass).toBe(true);
    });
  });
});
