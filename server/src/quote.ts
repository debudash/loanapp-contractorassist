// Quote engine: pure functions, no I/O, no model. Every number the homeowner
// sees starts here.
import { cents, deferredInterestOwed, monthlyPayment } from "./amortize.js";
import type { FixedProduct, Offer, Product } from "./domain.js";

/** Loan amounts the company offers, from the brief. */
export const LOAN_MIN = 5_000;
export const LOAN_MAX = 100_000;

/** Recorded with every offer set, so the audit trail knows which calculator produced the cards. */
export const QUOTE_VERSION = "quote@1";

/** Written as "not inside" so NaN is rejected too. */
export function amountInRange(amount: number): boolean {
  return amount >= LOAN_MIN && amount <= LOAN_MAX;
}

// ---------------------------------------------------------------- Ballpark

export type TermFit = "fits_any_rate" | "fits_some_rates" | "does_not_fit";

export interface BallparkRow {
  termMonths: number;
  monthlyLow: number;
  monthlyHigh: number;
  /** Only present when a budget was given (FR-2). */
  fit?: TermFit;
}

export type BallparkResult =
  | { ok: true; aprMin: number; aprMax: number; rows: BallparkRow[] }
  | { ok: false; reason: "amount_out_of_range"; min: number; max: number }
  | { ok: false; reason: "no_products" };

/**
 * FR-1: a payment range per term, from the lowest to the highest APR.
 * Fixed-rate products only: a promo's teaser payment must never appear without its cliff.
 */
export function ballpark(input: { amount: number; budget?: number }, products: Product[]): BallparkResult {
  const { amount, budget } = input;
  if (!amountInRange(amount)) {
    return { ok: false, reason: "amount_out_of_range", min: LOAN_MIN, max: LOAN_MAX };
  }
  const fixed = products.filter((p): p is FixedProduct => p.kind === "fixed");
  if (fixed.length === 0) return { ok: false, reason: "no_products" };

  const aprMin = Math.min(...fixed.map((p) => p.aprMin));
  const aprMax = Math.max(...fixed.map((p) => p.aprMax));
  const terms = [...new Set(fixed.map((p) => p.termMonths))].sort((a, b) => a - b);
  const rows = terms.map((termMonths) => {
    const monthlyLow = monthlyPayment(amount, aprMin, termMonths);
    const monthlyHigh = monthlyPayment(amount, aprMax, termMonths);
    return {
      termMonths,
      monthlyLow,
      monthlyHigh,
      ...(budget !== undefined && { fit: termFit(monthlyLow, monthlyHigh, budget) }),
    };
  });
  return { ok: true, aprMin, aprMax, rows };
}

function termFit(monthlyLow: number, monthlyHigh: number, budget: number): TermFit {
  if (monthlyHigh <= budget) return "fits_any_rate";
  if (monthlyLow <= budget) return "fits_some_rates";
  return "does_not_fit";
}

// ---------------------------------------------------------------- Offers

/** One offer with every disclosure field (FR-7), so no payment can be shown without them. */
interface DisclosedBase {
  offerId: string;
  monthlyPayment: number;
  aprPercent: number;
  termMonths: number;
  numPayments: number;
  amountFinanced: number;
  financeCharge: number;
  totalOfPayments: number;
  /** Only present when a budget was given (FR-8). */
  budgetFit?: { fits: true; under: number } | { fits: false; over: number };
}

/**
 * A promo always carries its conditions and its cliff: pay off `payoffAmount`
 * within `months`, or `deferredInterest` is added (the cliff line).
 */
export type DisclosedOffer =
  | (DisclosedBase & { kind: "fixed"; promo?: never })
  | (DisclosedBase & { kind: "deferred_interest"; promo: { months: number; payoffAmount: number; deferredInterest: number } });

/** Each label appears at most once, because figures() names placeholders after it. */
export type CardLabel =
  | "lowest_total"
  | "lowest_total_and_monthly"
  | "lowest_monthly"
  | "promo"
  | "next_lowest_total"
  | "next_lowest_total_2";

/** An offer chosen for one of the three card slots, labelled by what it's best at. */
export type Card = DisclosedOffer & { label: CardLabel };

/** What each label says on the card. Never "recommended" (NG-3). */
export const CARD_TITLES: Record<CardLabel, string> = {
  lowest_total: "Lowest total cost",
  lowest_total_and_monthly: "Lowest total cost and lowest monthly",
  lowest_monthly: "Lowest monthly",
  promo: "Promo",
  next_lowest_total: "Next lowest total cost",
  next_lowest_total_2: "Another low total cost",
};

/** What each figure is, by the part of its name after the card label ("lowest_monthly.cliff" → "cliff"). */
export const FIGURE_MEANINGS: Record<string, string> = {
  monthly: "monthly payment",
  apr: "APR",
  term_years: "term in years",
  num_payments: "number of payments",
  amount: "amount financed",
  finance_charge: "finance charge",
  total: "total of payments",
  under_budget: "under the homeowner's budget by",
  over_budget: "over the homeowner's budget by",
  months: "promo months",
  payoff: "amount to pay off within the promo months",
  cliff: "deferred interest added if not paid off in time",
};

/** What a figure name means, in words: "promo.cliff" → "deferred interest added if not paid off in time". */
// ISS-9: diff.total.rounded returned the exact difference's meaning, because the diff branch
// returned before ", rounded" was added. Every name now goes through the same rounded suffix.
export function figureMeaning(name: string): string {
  const base = name.replace(/\.rounded$/, "");
  const meaning =
    base === "budget" ? "the homeowner's monthly budget"
    : base === "diff.monthly" ? "how much more a month the lowest total cost offer is than the lowest monthly offer"
    : base === "diff.total" ? "how much less in total the lowest total cost offer costs than the lowest monthly offer"
    : (FIGURE_MEANINGS[base.split(".").slice(1).join(".")] ?? base);
  return name.endsWith(".rounded") ? `${meaning}, rounded` : meaning;
}

export const MAX_CARDS = 3;

/**
 * FR-6, FR-7: up to three cards, always in the same order so the order can't
 * nudge (NG-3). Labels say what each offer is best at, never "recommended":
 *   1. lowest total cost (labelled "lowest total and monthly" if it's both)
 *   2. lowest monthly payment
 *   3. the promo, if any
 * Remaining slots go to the next lowest total cost. Promos compete only for the
 * promo slot. `allOffers` backs the "See all N offers" link.
 */
export function presentOffers(
  offers: Offer[],
  budget?: number,
): { cards: Card[]; allOffers: DisclosedOffer[]; totalCount: number } {
  const allOffers = sortBy(offers.map((o) => disclose(o, budget)), (o) => o.totalOfPayments);
  const fixed = allOffers.filter((o) => o.kind === "fixed");

  const cards: Card[] = [];
  const lowestTotal = fixed[0];
  const lowestMonthly = sortBy(fixed, (o) => o.monthlyPayment)[0];
  if (lowestTotal && lowestTotal.offerId === lowestMonthly?.offerId) {
    cards.push({ ...lowestTotal, label: "lowest_total_and_monthly" });
  } else {
    if (lowestTotal) cards.push({ ...lowestTotal, label: "lowest_total" });
    if (lowestMonthly) cards.push({ ...lowestMonthly, label: "lowest_monthly" });
  }
  const promo = allOffers.find((o) => o.kind === "deferred_interest");
  if (promo) cards.push({ ...promo, label: "promo" });

  const shown = (o: DisclosedOffer) => cards.some((c) => c.offerId === o.offerId);
  const fillers = fixed.filter((o) => !shown(o)).slice(0, MAX_CARDS - cards.length);
  const fillerLabels = ["next_lowest_total", "next_lowest_total_2"] as const;
  fillers.forEach((o, i) => cards.push({ ...o, label: fillerLabels[i]! }));

  return { cards, allOffers, totalCount: offers.length };
}

/** Stable sort by the measure; ties broken by offer ID so the result never depends on input order. */
function sortBy(offers: DisclosedOffer[], measure: (o: DisclosedOffer) => number): DisclosedOffer[] {
  return [...offers].sort((a, b) => measure(a) - measure(b) || a.offerId.localeCompare(b.offerId));
}

function disclose(offer: Offer, budget?: number): DisclosedOffer {
  const monthly = monthlyPayment(offer.amount, offer.aprPercent, offer.termMonths);
  // Total of payments uses the rounded payment: what the borrower actually pays (A-7).
  const totalOfPayments = cents(monthly * offer.termMonths);
  const base: DisclosedBase = {
    offerId: offer.id,
    monthlyPayment: monthly,
    aprPercent: offer.aprPercent,
    termMonths: offer.termMonths,
    numPayments: offer.termMonths,
    amountFinanced: offer.amount,
    financeCharge: cents(totalOfPayments - offer.amount),
    totalOfPayments,
    ...(budget !== undefined && { budgetFit: budgetFit(monthly, budget) }),
  };
  if (offer.kind === "fixed") return { ...base, kind: "fixed" };
  return {
    ...base,
    kind: "deferred_interest",
    promo: {
      months: offer.promoMonths,
      payoffAmount: offer.amount,
      deferredInterest: deferredInterestOwed(offer.amount, offer.aprPercent, monthly, offer.promoMonths),
    },
  };
}

function budgetFit(monthly: number, budget: number): NonNullable<DisclosedOffer["budgetFit"]> {
  return monthly <= budget ? { fits: true, under: cents(budget - monthly) } : { fits: false, over: cents(monthly - budget) };
}

// ---------------------------------------------------------------- Figures

/** Placeholder name -> display text, e.g. "lowest_monthly.monthly" -> "$289.31". */
export type Figures = Record<string, string>;

/**
 * G-1: the only numbers the assistant can use. The model writes {{name}};
 * render() fills it from this table. Names follow the card label, so they
 * don't depend on card order.
 */
export function figures(cards: Card[], budget?: number): Figures {
  const out: Figures = {};
  if (budget !== undefined) out.budget = money(budget);
  for (const card of cards) {
    const prefix = card.label;
    out[`${prefix}.monthly`] = money(card.monthlyPayment);
    out[`${prefix}.apr`] = `${card.aprPercent}%`;
    out[`${prefix}.term_years`] = String(card.termMonths / 12);
    out[`${prefix}.num_payments`] = String(card.numPayments);
    out[`${prefix}.amount`] = money(card.amountFinanced);
    addLifetimeTotal(out, `${prefix}.finance_charge`, card.financeCharge);
    addLifetimeTotal(out, `${prefix}.total`, card.totalOfPayments);
    if (card.budgetFit?.fits === true) out[`${prefix}.under_budget`] = money(card.budgetFit.under);
    if (card.budgetFit?.fits === false) out[`${prefix}.over_budget`] = money(card.budgetFit.over);
    if (card.promo) {
      out[`${prefix}.months`] = String(card.promo.months);
      out[`${prefix}.payoff`] = money(card.promo.payoffAmount);
      out[`${prefix}.cliff`] = money(card.promo.deferredInterest);
    }
  }

  const lowestTotal = cards.find((c) => c.label === "lowest_total");
  const lowestMonthly = cards.find((c) => c.label === "lowest_monthly");
  if (lowestTotal && lowestMonthly) {
    out["diff.monthly"] = money(cents(lowestTotal.monthlyPayment - lowestMonthly.monthlyPayment));
    addLifetimeTotal(out, "diff.total", cents(lowestMonthly.totalOfPayments - lowestTotal.totalOfPayments));
  }
  return out;
}

/**
 * A lifetime total gets an exact form and, from $1,000 up, a rounded form for
 * the spoken line. Monthly payment, APR, term and cliff never get one, so the
 * model can't round them (G-1).
 */
function addLifetimeTotal(out: Figures, name: string, amount: number): void {
  out[name] = money(amount);
  if (amount < 1_000) return;
  const step = amount >= 10_000 ? 1_000 : 100;
  const rounded = Math.round(amount / step) * step;
  out[`${name}.rounded`] = `about ${rounded.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
}

function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
