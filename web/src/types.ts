// The API's response shapes, mirrored by hand from the server (server/src/quote.ts, assist.ts, app.ts).

export type CardLabel =
  | "lowest_total"
  | "lowest_total_and_monthly"
  | "lowest_monthly"
  | "promo"
  | "next_lowest_total"
  | "next_lowest_total_2";

export interface DisclosedOffer {
  offerId: string;
  kind: "fixed" | "deferred_interest";
  monthlyPayment: number;
  aprPercent: number;
  termMonths: number;
  numPayments: number;
  amountFinanced: number;
  financeCharge: number;
  totalOfPayments: number;
  promo?: { months: number; payoffAmount: number; deferredInterest: number };
  budgetFit?: { fits: true; under: number } | { fits: false; over: number };
}

export type Card = DisclosedOffer & { label: CardLabel };

export interface BallparkRow {
  termMonths: number;
  monthlyLow: number;
  monthlyHigh: number;
  fit?: "fits_any_rate" | "fits_some_rates" | "does_not_fit";
}

export type BallparkResult =
  | { ok: true; aprMin: number; aprMax: number; rows: BallparkRow[] }
  | { ok: false; reason: "amount_out_of_range"; min: number; max: number }
  | { ok: false; reason: "no_products" };

export interface OffersResult {
  noOffers: boolean;
  offerSetId: number;
  message?: string;
  cards: Card[];
  allOffers: DisclosedOffer[];
  totalCount: number;
}

export interface SuggestedInputs {
  amount?: number;
  budget?: number;
  projectType?: string;
}

export type AssistResult =
  | { kind: "suggestion"; inputs: SuggestedInputs; dropped: string[] }
  | { kind: "answer"; outcome: "answered" | "standard_explanation" | "redirected"; answer: string; say: string }
  | { kind: "unavailable"; message: string };

export interface ChatMessage {
  question: string;
  result: AssistResult;
}

/** Compliance-owned wording, served by GET /api/wording from compliance-rules.json. */
export interface Wording {
  version: string;
  uiWording: { consent: string; ballparkFinePrint: string; promoCliff: string; noBudgetHint: string };
}
