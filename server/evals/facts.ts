// What the eval judges are shown. ISS-6: the first live run's judge failed correct answers
// because it didn't know which line is read aloud to the homeowner ("your budget" is right
// there) and the facts listed "cliff $4,409.69" without saying what the cliff is.
import type { AssistResult } from "../src/assist.js";
import { type Card, CARD_TITLES, type Figures, figureMeaning } from "../src/quote.js";

/** The facts on screen, per offer, with each figure named by what it means. */
export function screenFacts(cards: Card[], figures: Figures, termsTexts: string[]): string {
  const offers = cards.map((card) => {
    // Every figure on the card, described by its meaning; none can silently drop out.
    const own = Object.entries(figures)
      .filter(([name]) => name.startsWith(`${card.label}.`) && !name.endsWith(".rounded"))
      .map(([name, value]) => `${figureMeaning(name)} ${value}`);
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
