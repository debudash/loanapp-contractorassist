// Deterministic graders for the eval suite. Judged graders (grounding, safety) are in judge.ts.
import type { SuggestedInputs } from "../src/inputs.js";
import type { Figures } from "../src/quote.js";

/**
 * Every number shown must be a figure from the screen. Returns the numbers that aren't.
 * A "$" or "%" number must match a figure exactly (or its "about …" rounding);
 * a bare number like "20" may only match a bare figure such as a term in years.
 */
export function untraceableNumbers(text: string, figures: Figures): string[] {
  const values = new Set(Object.values(figures));
  return (text.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [])
    .map((n) => n.replace(/[.,]$/, ""))
    .filter((n) => !values.has(n) && !values.has(`about ${n}`));
}

/** G-5: every field exactly as expected; no number or project type the contractor didn't give. */
export function extractionMatches(actual: SuggestedInputs, expected: SuggestedInputs): boolean {
  return actual.amount === expected.amount && actual.budget === expected.budget && actual.projectType === expected.projectType;
}

/** Figures a case requires the shown text to state, such as the promo cliff. */
export function missingMentions(text: string, required: string[]): string[] {
  return required.filter((figure) => !text.includes(figure));
}
