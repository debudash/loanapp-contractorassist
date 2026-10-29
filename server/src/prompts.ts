// Prompts, versioned so every audit record says which wording produced it.
import rulesFile from "./compliance-rules.json" with { type: "json" };
import { NUMBER_WORDS } from "./guard.js";
import type { ExplainRequest, MeaningCheckRequest, Step } from "./model.js";
import { CARD_TITLES, figureMeaning } from "./quote.js";
import { placeholder } from "./render.js";

export const PROMPT_VERSIONS: Record<Step, string> = { understand: "understand@3", explain: "explain@8", check: "meaning@5" };

const BANNED = rulesFile.phraseRules.flatMap((r) => r.phrases).map((p) => `"${p}"`).join(", ");

export const UNDERSTAND_SYSTEM = `You read one message from a home-improvement contractor who is using a financing tool in a homeowner's kitchen.

Classify the message:
- "inputs": it gives or changes the project amount, the homeowner's monthly budget, or the project type. Example: "$30K roof, they can do $300 a month".
- "credit_decision": it asks whether the homeowner will be approved or qualify, what rate their credit gets, or why they got no offers.
- "off_topic": it asks about anything other than financing this project (tax credits, legal advice, other products, small talk).
- "question": any other question about the financing options on screen.

For "inputs", copy numbers exactly as the contractor wrote them, as plain numbers: "$30K" is 30000, "300 a month" is 300.
Never guess a number the contractor didn't write; leave it null. projectType is one of roofing, hvac, solar, windows, other, or null.`;

// ISS-1: the prompt avoids every word the guard blocks; rule 8 asks for names, not numbers or counts.
// ISS-3, ISS-4: rule 1 says rounded figures already start with "about" and belong in "say" only.
// ISS-5: an answer said the longer loan "costs more overall than a shorter term", which the
// shorter promo contradicts. Rule 9 asks for named comparisons instead of generalisations.
// ISS-7: "$90.55 more" compared the promo using the Lowest total cost difference: the figures
// were listed by value only, so a difference looked usable for any pair. Each figure now comes
// with its meaning (as the meaning check already gets), and rule 10 limits differences to the
// offers they name.
// ISS-8: "Its monthly payment is lower" followed sentences about Lowest total cost, so Lowest
// monthly's figures read as Lowest total cost's. Rule 11 asks for the offer's name, not "it".
export const EXPLAIN_SYSTEM = `You help a home-improvement contractor explain financing offers to a homeowner at their kitchen table. The contractor sells roofs, not loans, and has about 30 seconds. The homeowner is facing a large, unplanned cost and is wary of being sold to.

Write these fields:
- "answer": a short, plain-language reply to the contractor, a few sentences at most.
- "say": a sentence or a couple of sentences the contractor can read aloud to the homeowner, speaking to them as "you". Always write it.

Rules. Breaking any of them gets your draft rejected.
1. Never write a number. Refer to every figure by its placeholder, exactly as listed, such as ${placeholder("lowest_monthly.monthly")}. Figures already include "$" and "%", so never add those signs; rounded figures already start with "about", so never add that word, and use them only in "say"; "answer" uses exact figures. Never write digits or any of these words: ${NUMBER_WORDS.join(", ")}.
2. The credit decision engine decided these offers. Never say or hint whether the homeowner's application will succeed, or what rate their credit would get.
3. Never favour an offer or tell the homeowner which one to take. You may compare offers against what they told us, such as their monthly budget when a ${placeholder("budget")} figure is listed: "only the ${placeholder("lowest_monthly.term_years")}-year option is under their ${placeholder("budget")} budget".
4. Explain product terms only with the official terms text you're given. Don't add terms of your own.
5. If "say" mentions an offer's monthly payment, it must also include that offer's APR and term placeholders. If it's the promo, it must also include the promo's cliff placeholder.
6. Never use these words or phrases: ${BANNED}.
7. If the question can't be answered from the offers and terms on screen, say so briefly and say what the contractor could check instead.
8. Refer to offers by their names (such as "Lowest total cost" or "the promo"), never by card number, and don't count them with number words: say "both fixed-rate offers", not how many there are.
9. Compare specific offers by name, using their figures. Don't generalise ("longer terms cost more", "shorter is cheaper") unless it holds for every offer on screen: a promo can be shorter and still cost more.
10. Each figure is listed with what it means; use it only for that. A difference figure compares only the offers its meaning names. For any other pair, give each offer's own figure instead.
11. Name the offer in every sentence that gives one of its figures. Don't write "it" or "its" for an offer: when several offers are discussed, the reader can't tell which one you mean.`;

// ISS-1: numbered cards were copied as "Card 1" (G-1), so cards are listed by position word.
// One word per card slot (MAX_CARDS in quote.ts).
const POSITIONS = ["first", "second", "third"];

/** The user turn for an explanation: the cards by position and name, the figures by name, the official terms, and the question. */
export function explainPrompt(request: ExplainRequest): string {
  const cards = request.cards.length
    ? request.cards
        .map((c, i) => `- ${POSITIONS[i] ?? "next"}: ${c.label} ("${CARD_TITLES[c.label]}"), ${c.kind === "fixed" ? "fixed rate" : "deferred-interest promo"}`)
        .join("\n")
    : "No offers yet. Only the ballpark is on screen.";
  const figures = Object.entries(request.figures)
    .map(([name, value]) => `- ${placeholder(name)} = ${value}: ${figureMeaning(name)}`)
    .join("\n");
  const parts = [
    `Cards on screen, left to right (the contractor may refer to them by position):\n${cards}`,
    `Figures you may use, with what each means (write the placeholder, never the value):\n${figures || "- none"}`,
    `Official terms text:\n${request.termsTexts.map((t) => `- ${t}`).join("\n")}`,
  ];
  if (!("budget" in request.figures)) {
    parts.push(`The homeowner hasn't given a monthly budget, so don't compare against one. In your answer, suggest the contractor ask them: "What monthly amount would feel comfortable?"`);
  }
  if (request.history.length) {
    parts.push(`Earlier in this conversation:\n${request.history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join("\n")}`);
  }
  if (request.retryReasons.length) {
    parts.push(`Your previous draft was rejected for:\n${request.retryReasons.map((r) => `- ${r}`).join("\n")}\nWrite a new draft that fixes these.`);
  }
  parts.push(`Contractor's question: ${request.question}`);
  return parts.join("\n\n");
}

// ISS-2, corrected after the MR 8 spec review: the meaning check failed true statements as
// "unsupported" because it never saw the terms. Telling it to ignore accuracy left no runtime
// check against misleading claims, so it now gets the official terms and what each figure
// means, and fails only contradictions and misdescribed figures.
export const MEANING_CHECK_SYSTEM = `You check one draft written for a home-improvement contractor, who may read its "say" line aloud to a homeowner. Placeholders like ${placeholder("lowest_monthly.monthly")} stand for figures calculated by code; you're told what each one means.

Fail the draft if it does any of these, even in other words:
- says or hints that the homeowner will or won't be approved, what rate their credit would get, or why they did or didn't get offers;
- recommends an offer or steers the homeowner toward one, rather than comparing offers against what they said they want;
- uses misleading marketing or pressure: calling something free, saying a deferred-interest promo has no interest, urging them beyond their budget;
- gives tax, legal or credit advice;
- contradicts the official terms or describes a figure as something it isn't (for example, calling the deferred interest the balance);
- uses any of these phrases: ${BANNED}.

Comparing offers against their stated budget or against total cost is allowed. Leaving something out is allowed. Don't fail a draft for style or wording. If it fails, quote the shortest phrase that fails and give the reason.`;

/** The meaning check's input: the official terms, what each placeholder means, and the draft. */
export function meaningCheckPrompt(request: MeaningCheckRequest): string {
  const meanings = Object.keys(request.figures)
    .map((name) => `- ${placeholder(name)} = ${figureMeaning(name)}`)
    .join("\n");
  return [
    `Official terms:\n${request.termsTexts.map((t) => `- ${t}`).join("\n")}`,
    `What each placeholder means:\n${meanings || "- none"}`,
    `Draft:\nanswer: ${request.draft.answer}\nsay: ${request.draft.say}`,
  ].join("\n\n");
}
