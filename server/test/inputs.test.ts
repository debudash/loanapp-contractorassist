import { describe, expect, it } from "vitest";
import { checkInputs } from "../src/inputs.js";

describe("checkInputs (G-5)", () => {
  it("keeps numbers the contractor actually typed, however they wrote them", () => {
    const suggested = { amount: 30_000, budget: 300, projectType: "roofing" };

    expect(checkInputs("$30K roof, she can do $300/mo", suggested)).toEqual({ inputs: suggested, dropped: [] });
    expect(checkInputs("roof for 30,000 and 300 a month", suggested)).toEqual({ inputs: suggested, dropped: [] });
  });

  // Review fix (slice 2, spec S9): found by spec review; "$64.1k" failed on floating point,
  // and "thousand" / "grand" weren't read.
  it.each([
    ["$64.1k", 64_100],
    ["30 thousand", 30_000],
    ["30 grand", 30_000],
  ])("reads %s as %d", (typed, amount) => {
    expect(checkInputs(`roof, ${typed}`, { amount })).toEqual({ inputs: { amount }, dropped: [] });
  });

  it("drops a number the model invented and says which field is now empty", () => {
    const suggested = { amount: 25_000, projectType: "roofing" };

    expect(checkInputs("new roof, she wants it cheap", suggested)).toEqual({
      inputs: { projectType: "roofing" },
      dropped: ["amount"],
    });
  });
});
