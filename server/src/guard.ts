// Guard: the deterministic layer of checks on the model's draft before anything
// is shown (PRD G-1 to G-4). Each rule is one small function. Phrase lists are a
// floor: rewordings they miss are left to the meaning check and the evals.
import rulesFile from "./compliance-rules.json" with { type: "json" };
import type { Figures } from "./quote.js";
import { placeholder, placeholdersIn, withoutPlaceholders } from "./render.js";

/** The model's two fields: the answer for the contractor and the line to say aloud. */
export interface Draft {
  answer: string;
  say: string;
}

/** What is on screen: the figures the model may use, and whether a promo card is showing. */
export interface Screen {
  figures: Figures;
  promoOnScreen: boolean;
}

export interface Failure {
  rule: "G-1" | "G-2" | "G-3" | "G-4";
  reason: string;
  quote: string;
}

interface PhraseRule {
  rule: "G-2" | "G-3";
  reason: string;
  phrases: string[];
  whenPromoOnScreen: boolean;
}

/** The compliance file, checked once at load so a typo in it fails loudly instead of silently. */
const PHRASE_RULES: PhraseRule[] = rulesFile.phraseRules.map((r) => {
  if (r.rule !== "G-2" && r.rule !== "G-3") throw new Error(`compliance-rules.json: unknown rule "${r.rule}"`);
  return { rule: r.rule, reason: r.reason, phrases: r.phrases, whenPromoOnScreen: r.whenPromoOnScreen === true };
});

export function guard(draft: Draft, screen: Screen): { pass: boolean; failures: Failure[] } {
  const failures = [
    ...[draft.answer, draft.say].flatMap((text) => [...numberFidelity(text, screen), ...phrases(text, screen)]),
    ...spokenPayments(draft.say, screen),
    ...roundedFigures(draft),
  ];
  return { pass: failures.length === 0, failures };
}

/**
 * G-1 for rounded figures ("about $24,000"), one failure per placeholder:
 * - ISS-4: they exist for the line said aloud; the answer the contractor reads uses exact
 *   figures. "How much in total?" was answered with "about $69,000" instead of the card's total.
 * - ISS-3: they already start with "about", so "about {{x.rounded}}" rendered "about about".
 */
function roundedFigures(draft: Draft): Failure[] {
  const failures: Failure[] = [];
  for (const { placeholder: quote, name } of placeholdersIn(draft.answer)) {
    if (name.endsWith(".rounded")) failures.push({ rule: "G-1", reason: "rounded figure outside the spoken line", quote });
  }
  for (const { placeholder, name } of placeholdersIn(draft.say)) {
    if (!name.endsWith(".rounded")) continue;
    const doubled = new RegExp(`\\babout\\s+${placeholder.replace(/[.{}]/g, "\\$&")}`, "i").exec(draft.say);
    if (doubled) failures.push({ rule: "G-1", reason: "rounded figure already says 'about'", quote: doubled[0] });
  }
  return failures;
}

// Number words the model might use to slip a figure past the digit check.
// "one" is left out: it's mostly a pronoun ("this one fits her budget").
// "half" and "grand" stay in even though they block the odd honest sentence.
export const NUMBER_WORDS = [
  "zero", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
  "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million",
  "half", "dozen", "grand", "percent",
  "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
  "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
  "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth", "hundredth",
  "thousandth",
];
// \b splits on hyphens on purpose, so "twenty-four" is caught as "twenty" and "four".
const NUMBER_WORD_PATTERN = new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\b`, "gi");

/** G-1: every number comes from code. Fails numbers the model wrote, and placeholders that are off screen or malformed. */
function numberFidelity(text: string, screen: Screen): Failure[] {
  const failures: Failure[] = [];
  for (const { placeholder, name } of placeholdersIn(text)) {
    if (!Object.hasOwn(screen.figures, name)) {
      failures.push({ rule: "G-1", reason: "placeholder not on this screen", quote: placeholder });
    }
  }
  const prose = withoutPlaceholders(text);
  // Any brace left once well-formed placeholders are removed would show on screen.
  for (const quote of prose.match(/[{}]+/g) ?? []) {
    failures.push({ rule: "G-1", reason: "malformed placeholder", quote });
  }
  // Any Unicode digit (not just 0-9), the % and $ signs (figures already carry them), and number words.
  for (const quote of [...(prose.match(/\p{Nd}[\p{Nd},.]*|%|\$/gu) ?? []), ...(prose.match(NUMBER_WORD_PATTERN) ?? [])]) {
    failures.push({ rule: "G-1", reason: "number written by the model", quote });
  }
  return failures;
}

/** G-2 and G-3: phrases from the compliance rules file, matched as whole words. */
function phrases(text: string, screen: Screen): Failure[] {
  return PHRASE_RULES.filter((r) => !r.whenPromoOnScreen || screen.promoOnScreen).flatMap((r) =>
    findPhrases(text, r.phrases).map((quote) => ({ rule: r.rule, reason: r.reason, quote })),
  );
}

/**
 * G-4: the spoken line reaches the homeowner without the card, so a payment
 * said aloud must come with that offer's APR and term, and a promo's with its cliff.
 */
function spokenPayments(say: string, screen: Screen): Failure[] {
  const failures: Failure[] = [];
  const has = (name: string) => say.includes(placeholder(name));
  for (const { placeholder: quote, name } of placeholdersIn(say)) {
    if (!name.endsWith(".monthly")) continue;
    const offer = name.slice(0, -".monthly".length);
    // Only an offer's payment needs disclosures; diff.monthly is a difference, not a payment.
    if (!Object.hasOwn(screen.figures, `${offer}.apr`)) continue;
    if (!has(`${offer}.apr`) || !has(`${offer}.term_years`)) {
      failures.push({ rule: "G-4", reason: "spoken payment without its APR and term", quote });
    }
    if (Object.hasOwn(screen.figures, `${offer}.cliff`) && !has(`${offer}.cliff`)) {
      failures.push({ rule: "G-4", reason: "spoken promo payment without its cliff", quote });
    }
  }
  return failures;
}

/** Folds look-alike characters so a phrase can't hide behind them. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, " ") // zero-width characters
    .replace(/[‐-―−]/g, "-") // dashes and hyphens
    .replace(/[‘’]/g, "'") // curly apostrophes
    .replace(/\s+/g, " ");
}

/**
 * Whole-phrase matches, in the order they appear in the normalised text.
 * Hyphens count as part of a word, so "pre-approved" isn't also reported as
 * "approved", and "penalty-free" doesn't trip "free".
 */
function findPhrases(text: string, phrases: string[]): string[] {
  const normalised = normalise(text);
  const found: { at: number; quote: string }[] = [];
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of normalised.matchAll(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "gi"))) {
      found.push({ at: match.index, quote: match[0] });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.quote);
}
