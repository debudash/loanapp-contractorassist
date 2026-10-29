// What the eval judges are shown. ISS-6: the first live run's judge failed correct answers
// because it didn't know which line is read aloud to the homeowner ("your budget" is right
// there) and the facts listed "cliff $4,409.69" without saying what the cliff is.
import type { AssistResult } from "../src/assist.js";
import { type Card, CARD_TITLES, type Figures } from "../src/quote.js";

/** What each figure name means, in words the judge can check claims against. */
const MEANINGS: Record<string, string> = {
  monthly: "monthly payment",
  apr: "APR",
  term_years: "term in years",
  num_payments: "number of payments",
  amount: "amount financed",
  finance_charge: "finance charge",
  total: "total of payments",
  under_budget: "under her budget by",
  over_budget: "over her budget by",
  months: "promo months",
  payoff: "amount to pay off within the promo months",
  cliff: "deferred interest added if not paid off in time (the cliff)",
};

/** The facts on screen, per offer, with each figure named by what it means. */
export function screenFacts(cards: Card[], figures: Figures, termsTexts: string[]): string {
  const offers = cards.map((card) => {
    const own = Object.entries(MEANINGS)
      .filter(([key]) => figures[`${card.label}.${key}`] !== undefined)
      .map(([key, meaning]) => `${meaning} ${figures[`${card.label}.${key}`]}`);
    return `- ${CARD_TITLES[card.label]}: ${own.join("; ")}`;
  });
  return [
    offers.length ? `Offers:\n${offers.join("\n")}` : "No offers on screen.",
    figures.budget ? `Homeowner's monthly budget: ${figures.budget}` : "No monthly budget given.",
    `Official terms:\n${termsTexts.map((t) => `- ${t}`).join("\n")}`,
  ].join("\n");
}

/** What was shown, labelled by audience: the contractor's answer, and the line read aloud to the homeowner. */
export function shownForJudge(result: AssistResult): string {
  if (result.kind === "unavailable") return result.message;
  if (result.kind !== "answer") return "";
  const parts = [`Answer to the contractor:\n${result.answer}`];
  if (result.say) parts.push(`Line the contractor reads aloud to the homeowner:\n${result.say}`);
  return parts.join("\n\n");
}
