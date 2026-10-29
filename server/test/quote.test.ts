import { describe, expect, it } from "vitest";
import { ballpark, figureMeaning, figures, presentOffers } from "../src/quote.js";
import type { Offer, Product } from "../src/domain.js";

// Expected values are worked examples from the standard amortization formula,
// computed independently (not by this code).
const fixed = (termYears: number): Product => ({
  id: `fixed-${termYears}y`,
  name: `Fixed ${termYears}-year`,
  kind: "fixed",
  termMonths: termYears * 12,
  aprMin: 7.99,
  aprMax: 17.99,
  termsText: "Fixed rate for the life of the loan.",
});

describe("ballpark", () => {
  it("gives a monthly payment range per term, from the lowest to the highest APR", () => {
    const result = ballpark({ amount: 30_000 }, [fixed(10)]);

    expect(result).toEqual({
      ok: true,
      aprMin: 7.99,
      aprMax: 17.99,
      rows: [{ termMonths: 120, monthlyLow: 363.82, monthlyHigh: 540.36 }],
    });
  });

  it("labels each term against the homeowner's monthly budget", () => {
    const result = ballpark({ amount: 30_000, budget: 470 }, [fixed(5), fixed(10), fixed(20)]);

    if (!result.ok) throw new Error("expected a ballpark");
    expect(result.rows.map((r) => [r.termMonths, r.fit])).toEqual([
      [60, "does_not_fit"], //     $608.15 – $761.64
      [120, "fits_some_rates"], // $363.82 – $540.36
      [240, "fits_any_rate"], //   $250.75 – $462.76
    ]);
  });

  it("leaves promo products out, so no teaser payment appears without its cliff", () => {
    const promo: Product = {
      id: "promo-12m",
      name: "12 months deferred interest",
      kind: "deferred_interest",
      termMonths: 180,
      aprMin: 0,
      aprMax: 24.99,
      promoMonths: 12,
      termsText: "No interest if paid in full within 12 months.",
    };

    const result = ballpark({ amount: 30_000 }, [fixed(10), promo]);

    if (!result.ok) throw new Error("expected a ballpark");
    expect([result.aprMin, result.aprMax]).toEqual([7.99, 17.99]);
    expect(result.rows.map((r) => r.termMonths)).toEqual([120]);
  });

  it("rejects amounts outside $5K–$100K with the range instead of guessing", () => {
    const outOfRange = { ok: false, reason: "amount_out_of_range", min: 5_000, max: 100_000 };

    expect(ballpark({ amount: 150_000 }, [fixed(10)])).toEqual(outOfRange);
    expect(ballpark({ amount: 4_999 }, [fixed(10)])).toEqual(outOfRange);
    expect(ballpark({ amount: Number.NaN }, [fixed(10)])).toEqual(outOfRange);
  });

  // Review fix (slice 1, spec c1): found by spec review; empty catalog gave ok with Infinity APRs.
  it("returns no ballpark when the contractor has no fixed-rate products", () => {
    expect(ballpark({ amount: 30_000 }, [])).toEqual({ ok: false, reason: "no_products" });
  });

  // Review fix (slice 1, spec c3): found by spec review; duplicate terms gave duplicate rows.
  it("shows one row per term, shortest first", () => {
    const result = ballpark({ amount: 30_000 }, [fixed(20), fixed(10), { ...fixed(10), id: "fixed-10y-b" }]);

    if (!result.ok) throw new Error("expected a ballpark");
    expect(result.rows.map((r) => r.termMonths)).toEqual([120, 240]);
  });
});

// Offers as the credit decision engine returns them for a $30,000 roof.
const offer = (id: string, aprPercent: number, termYears: number): Offer => ({
  id,
  kind: "fixed",
  amount: 30_000,
  aprPercent,
  termMonths: termYears * 12,
});

const promo12: Offer = {
  id: "o-promo",
  kind: "deferred_interest",
  amount: 30_000,
  aprPercent: 15.99,
  termMonths: 180,
  promoMonths: 12,
};

describe("presentOffers", () => {
  it("shows every disclosure field on a card", () => {
    const { cards, totalCount } = presentOffers([offer("o-10y", 8.99, 10)]);

    expect(totalCount).toBe(1);
    expect(cards).toEqual([
      {
        label: "lowest_total_and_monthly",
        offerId: "o-10y",
        kind: "fixed",
        monthlyPayment: 379.86,
        aprPercent: 8.99,
        termMonths: 120,
        numPayments: 120,
        amountFinanced: 30_000,
        financeCharge: 15_583.2,
        totalOfPayments: 45_583.2,
      },
    ]);
  });

  it("shows three cards in a fixed order: lowest total cost, lowest monthly, promo", () => {
    const offers = [
      offer("o-25y", 12.99, 25), // higher monthly and higher total than the 20- and 10-year offers
      promo12,
      offer("o-20y", 9.99, 20), //  $289.31: lowest monthly
      offer("o-15y", 9.49, 15),
      offer("o-10y", 8.99, 10), //  $45,583.20 total: lowest total cost
    ];

    const { cards, totalCount } = presentOffers(offers);

    expect(totalCount).toBe(5);
    expect(cards.map((c) => [c.label, c.offerId])).toEqual([
      ["lowest_total", "o-10y"],
      ["lowest_monthly", "o-20y"],
      ["promo", "o-promo"],
    ]);
  });

  it("fills the third card with the next lowest total cost when there is no promo", () => {
    const offers = [offer("o-25y", 12.99, 25), offer("o-20y", 9.99, 20), offer("o-15y", 9.49, 15), offer("o-10y", 8.99, 10)];

    const { cards } = presentOffers(offers);

    expect(cards.map((c) => [c.label, c.offerId])).toEqual([
      ["lowest_total", "o-10y"],
      ["lowest_monthly", "o-20y"],
      ["next_lowest_total", "o-15y"],
    ]);
  });

  it("adds the promo conditions and the cliff to a deferred-interest card", () => {
    const { cards } = presentOffers([promo12]);

    expect(cards[0]).toMatchObject({
      label: "promo",
      monthlyPayment: 440.4,
      totalOfPayments: 79_272,
      financeCharge: 49_272,
      // Interest builds on the falling principal during the promo. If the balance
      // isn't cleared by month 12, all of it is charged.
      promo: { months: 12, payoffAmount: 30_000, deferredInterest: 4_409.69 },
    });
  });

  it("shows whether each card fits the homeowner's budget, and by how much", () => {
    const { cards } = presentOffers([offer("o-10y", 8.99, 10), offer("o-20y", 9.99, 20), promo12], 300);

    expect(cards.map((c) => [c.offerId, c.budgetFit])).toEqual([
      ["o-10y", { fits: false, over: 79.86 }],
      ["o-20y", { fits: true, under: 10.69 }],
      ["o-promo", { fits: false, over: 140.4 }],
    ]);
  });
});

describe("presentOffers edge cases", () => {
  // Review fix (slice 1, spec c4): found by spec review; a 9.99% 10-year offer was labelled
  // "lowest monthly" while the 8.99% 10-year offer had the lower payment.
  it("never puts a false label on a card: one offer can be lowest total and lowest monthly", () => {
    const { cards } = presentOffers([offer("o-b", 9.99, 10), offer("o-a", 8.99, 10)]);

    expect(cards.map((c) => [c.label, c.offerId])).toEqual([
      ["lowest_total_and_monthly", "o-a"],
      ["next_lowest_total", "o-b"],
    ]);
  });

  it("shows only the promo when the engine returns only a promo", () => {
    expect(presentOffers([promo12]).cards.map((c) => c.label)).toEqual(["promo"]);
  });

  it("shows no cards when the engine returns no offers", () => {
    expect(presentOffers([])).toEqual({ cards: [], allOffers: [], totalCount: 0 });
  });

  it("breaks ties by offer ID, so the same offers always give the same cards", () => {
    const { cards } = presentOffers([offer("o-2", 8.99, 10), offer("o-1", 8.99, 10)]);

    expect(cards.map((c) => [c.label, c.offerId])).toEqual([
      ["lowest_total_and_monthly", "o-1"],
      ["next_lowest_total", "o-2"],
    ]);
  });

  // Review fix (slice 1, spec a1): found by spec review; "See all N offers" had a count but no offers.
  it("returns every offer with full disclosures for 'See all', lowest total cost first", () => {
    const { allOffers } = presentOffers([offer("o-20y", 9.99, 20), promo12, offer("o-10y", 8.99, 10)]);

    expect(allOffers.map((o) => [o.offerId, o.totalOfPayments])).toEqual([
      ["o-10y", 45_583.2],
      ["o-20y", 69_434.4],
      ["o-promo", 79_272],
    ]);
  });

  // Review fix (slice 1, spec c6): found by spec review; interest went negative once
  // payments had cleared the principal.
  it("stops accruing deferred interest once the principal is paid off", () => {
    const shortPromo: Offer = { ...promo12, id: "o-short", amount: 6_000, aprPercent: 12, termMonths: 6 };

    expect(presentOffers([shortPromo]).cards[0]?.promo?.deferredInterest).toBe(204.71);
  });
});

describe("figures", () => {
  const { cards } = presentOffers([offer("o-10y", 8.99, 10), offer("o-20y", 9.99, 20), promo12], 300);

  // ISS-9: found by the MR 10 review; the explain model now reads these meanings, and the
  // rounded total difference was described as exact.
  it("ISS-9: says a rounded figure is rounded, for every rounded figure on screen", () => {
    const rounded = Object.keys(figures(cards, 300)).filter((name) => name.endsWith(".rounded"));

    expect(rounded).toContain("diff.total.rounded");
    for (const name of rounded) expect(figureMeaning(name)).toMatch(/, rounded$/);
  });

  it("names every figure by card label, formatted for display", () => {
    expect(figures(cards)).toMatchObject({
      "lowest_total.monthly": "$379.86",
      "lowest_total.apr": "8.99%",
      "lowest_total.term_years": "10",
      "lowest_total.num_payments": "120",
      "lowest_total.total": "$45,583.20",
      "lowest_total.over_budget": "$79.86",
      "lowest_monthly.monthly": "$289.31",
      "lowest_monthly.term_years": "20",
      "lowest_monthly.under_budget": "$10.69",
      "promo.months": "12",
      "promo.cliff": "$4,409.69",
      "promo.payoff": "$30,000.00",
      // Lowest total cost compared with lowest monthly.
      "diff.monthly": "$90.55",
      "diff.total": "$23,851.20",
    });
  });

  it("offers rounded forms only for lifetime totals, never for payment, APR, term or cliff", () => {
    const f = figures(cards);

    expect(f).toMatchObject({
      "lowest_total.total.rounded": "about $46,000",
      "lowest_total.finance_charge.rounded": "about $16,000",
      "diff.total.rounded": "about $24,000",
    });
    expect(Object.keys(f).filter((k) => k.endsWith(".rounded")).sort()).toEqual([
      "diff.total.rounded",
      "lowest_monthly.finance_charge.rounded",
      "lowest_monthly.total.rounded",
      "lowest_total.finance_charge.rounded",
      "lowest_total.total.rounded",
      "promo.finance_charge.rounded",
      "promo.total.rounded",
    ]);
  });

  // Review fix (slice 1, spec c9): found by spec review; small amounts rounded to "about $0".
  it("gives no rounded form for amounts under $1,000", () => {
    const lowRate = presentOffers([{ ...offer("o-low", 0.5, 1), amount: 5_000 }]);

    expect(lowRate.cards[0]?.financeCharge).toBe(13.6);
    expect(figures(lowRate.cards)).not.toHaveProperty("lowest_total_and_monthly.finance_charge.rounded");
  });

  // Review fix (slice 1, spec re-review 1): found by spec re-review; two cards labelled
  // "next_lowest_total" shared placeholder names, so the second overwrote the first.
  it("gives every card its own placeholder names, even two 'next lowest total' cards", () => {
    const { cards } = presentOffers([offer("o-c", 10.99, 10), offer("o-a", 8.99, 10), offer("o-b", 9.99, 10)]);

    expect(cards.map((c) => c.label)).toEqual(["lowest_total_and_monthly", "next_lowest_total", "next_lowest_total_2"]);
    expect(figures(cards)).toMatchObject({
      "lowest_total_and_monthly.monthly": "$379.86",
      "next_lowest_total.monthly": "$396.29",
      "next_lowest_total_2.monthly": "$413.08",
    });
  });

  // Review fix (slice 4, spec S5): found by spec review; "under her $300 budget" had no figure to use.
  it("names the budget as a figure when one was given", () => {
    expect(figures(cards, 300)).toMatchObject({ budget: "$300.00" });
    expect(figures(cards)).not.toHaveProperty("budget");
  });
});

describe("card titles", () => {
  // Found by the MR 8 spec review: two filler cards shared a title, so "refer to offers by
  // name" couldn't tell them apart.
  it("gives every card label its own title", async () => {
    const { CARD_TITLES } = await import("../src/quote.js");
    const titles = Object.values(CARD_TITLES);

    expect(new Set(titles).size).toBe(titles.length);
  });
});
