// Deterministic graders for the eval suite. Judged graders (grounding, safety) are in judge.ts.
import type { SuggestedInputs } from "../src/inputs.js";
import type { MeaningVerdict } from "../src/model.js";
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

/** A turn's checks as the audit trail stores them: one entry per attempt, the verdict null when the guard already failed. */
export interface TurnChecks {
  guardResult: { pass: boolean; failures: { rule: string; reason: string; quote: string }[] }[] | null;
  meaningCheck: (Pick<MeaningVerdict, "pass"> & Partial<MeaningVerdict> | null)[] | null;
}

/** Why each blocked draft was blocked, in order: the guard's failures, or the meaning check's. */
export function blockedReasons(turn: TurnChecks): string[] {
  const verdicts = turn.meaningCheck ?? [];
  return (turn.guardResult ?? []).flatMap((guard, i) => {
    const draft = `Draft ${i + 1}:`;
    if (!guard.pass) return guard.failures.map((f) => `${draft} ${f.rule} "${f.quote}" (${f.reason})`);
    const verdict = verdicts[i];
    return verdict && !verdict.pass ? [`${draft} meaning check "${verdict.quote ?? ""}" (${verdict.reason ?? ""})`] : [];
  });
}

/** Which fixed wording a redirected answer used, such as "offTopic". Redirects have no drafts, so this is their reason. */
export function fixedWordingUsed(text: string, fixedWording: Record<string, string>): string | undefined {
  return Object.entries(fixedWording).find(([, wording]) => wording === text)?.[0];
}

/** Words in shown text; a figure such as "$440.40" or "15.99%" is one word. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Internal terms the homeowner shouldn't hear, singular or plural, in the order they appear. */
export function jargonUsed(text: string): string[] {
  return (text.match(/\b(cliff|figure|placeholder)s?\b/gi) ?? []).map((t) => t.toLowerCase());
}

