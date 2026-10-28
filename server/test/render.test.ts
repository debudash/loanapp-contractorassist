import { describe, expect, it } from "vitest";
import { render } from "../src/render.js";

const figures = { "lowest_monthly.monthly": "$289.31", "lowest_monthly.term_years": "20" };

describe("render", () => {
  it("fills every placeholder with its figure", () => {
    const text = "The {{lowest_monthly.term_years}}-year plan is {{lowest_monthly.monthly}} a month.";

    expect(render(text, figures)).toBe("The 20-year plan is $289.31 a month.");
  });

  it("refuses to render a placeholder it has no figure for, rather than show a gap", () => {
    expect(() => render("It's {{promo.monthly}}.", figures)).toThrow("No figure named promo.monthly");
  });
});
