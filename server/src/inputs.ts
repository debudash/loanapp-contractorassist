import { cents } from "./amortize.js";

/** Inputs the assistant suggests from a chat message. The contractor applies them with one tap (FR-13). */
export interface SuggestedInputs {
  amount?: number;
  budget?: number;
  projectType?: string;
}

const NUMERIC_FIELDS = ["amount", "budget"] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

/**
 * G-5: the model may copy numbers but never invent them. Every number it
 * extracts must appear in what the contractor typed; otherwise that field is
 * left empty and named in `dropped`, so the contractor is asked for it.
 */
export function checkInputs(
  message: string,
  suggested: SuggestedInputs,
): { inputs: SuggestedInputs; dropped: NumericField[] } {
  const typed = numbersIn(message);
  const inputs: SuggestedInputs = { ...suggested };
  const dropped: NumericField[] = [];
  for (const field of NUMERIC_FIELDS) {
    const value = suggested[field];
    if (value === undefined || typed.has(value)) continue;
    inputs[field] = undefined;
    dropped.push(field);
  }
  return { inputs, dropped };
}

/** Every number in the text, reading "30K", "30 thousand" and "30 grand" as 30000, ignoring "$" and commas. */
function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const [, digits, thousands] of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|grand)?\b/gi)) {
    // cents() also absorbs float error: 64.1 * 1000 is 64099.999...
    found.add(cents(Number(digits!.replace(/,/g, "")) * (thousands ? 1_000 : 1)));
  }
  return found;
}
