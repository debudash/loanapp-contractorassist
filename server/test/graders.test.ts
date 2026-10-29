import { describe, expect, it } from "vitest";
import { blockedReasons, extractionMatches, missingMentions, untraceableNumbers } from "../evals/graders.js";

const figures = {
  "lowest_monthly.monthly": "$289.31",
  "lowest_monthly.term_years": "20",
  "lowest_monthly.apr": "9.99%",
  "diff.total.rounded": "about $24,000",
  budget: "$300.00",
};

describe("untraceableNumbers (M-1)", () => {
  it("accepts text whose every number is a figure on screen, including rounded totals and trailing punctuation", () => {
    expect(untraceableNumbers("The 20-year plan is $289.31 a month at 9.99% APR, under her $300.00. It costs about $24,000 more.", figures)).toEqual([]);
  });

  it("flags any number that isn't a figure", () => {
    expect(untraceableNumbers("That's about $290 a month, or 3% less.", figures)).toEqual(["$290", "3%"]);
  });

  // Review fix (slice 7, standards T4): found by standards review; "$20" passed because a term is "20".
  it("doesn't let a money or percent figure borrow a bare number's match", () => {
    expect(untraceableNumbers("Only $20 more.", figures)).toEqual(["$20"]);
  });
});

describe("extractionMatches (G-5)", () => {
  it("matches when every field is exactly right", () => {
    expect(extractionMatches({ amount: 30_000, budget: 300, projectType: "roofing" }, { amount: 30_000, budget: 300, projectType: "roofing" })).toBe(true);
  });

  it("fails an invented or wrong number", () => {
    expect(extractionMatches({ amount: 30_000, budget: 90_000 }, { amount: 30_000 })).toBe(false); // income is not a budget
    expect(extractionMatches({ amount: 25_000 }, { amount: 30_000 })).toBe(false);
  });

  // Review fix (slice 7, spec S7): found by spec review; an invented project type passed.
  it("fails a project type the contractor never gave", () => {
    expect(extractionMatches({ amount: 25_000, projectType: "roofing" }, { amount: 25_000 })).toBe(false);
  });
});

describe("missingMentions", () => {
  it("lists required figures the shown text leaves out", () => {
    expect(missingMentions("If she doesn't pay it off, interest is added.", ["$4,409.69"])).toEqual(["$4,409.69"]);
    expect(missingMentions("If not, $4,409.69 is added.", ["$4,409.69"])).toEqual([]);
  });
});

// Eval run 6 blocked an ordinary question once, and the run kept no record of why.
describe("blockedReasons", () => {
  it("says why each blocked draft was blocked, by the guard or the meaning check", () => {
    const turn = {
      guardResult: [
        { pass: false, failures: [{ rule: "G-1", reason: "number written by the model", quote: "two" }] },
        { pass: true, failures: [] },
      ],
      meaningCheck: [null, { pass: false, quote: "the smart choice", reason: "steers toward an offer" }],
    };

    expect(blockedReasons(turn)).toEqual([
      'Draft 1: G-1 "two" (number written by the model)',
      'Draft 2: meaning check "the smart choice" (steers toward an offer)',
    ]);
  });

  it("lists nothing for a draft that passed, or a turn that never reached the model", () => {
    expect(blockedReasons({ guardResult: [{ pass: true, failures: [] }], meaningCheck: [{ pass: true }] })).toEqual([]);
    expect(blockedReasons({ guardResult: [], meaningCheck: [] })).toEqual([]);
  });
});
