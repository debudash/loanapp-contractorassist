import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfferCard } from "../src/components/OfferCards";
import type { Card } from "../src/types";

const promoCliff = "Pay off {payoff} within {months} months and the built-up interest isn't charged. If not, {cliff} of deferred interest is added.";

// The worked examples from the quote engine: the $30,000 roof with a $300 budget.
const twentyYear: Card = {
  label: "lowest_monthly",
  offerId: "moderate-20y",
  kind: "fixed",
  monthlyPayment: 289.31,
  aprPercent: 9.99,
  termMonths: 240,
  numPayments: 240,
  amountFinanced: 30_000,
  financeCharge: 39_434.4,
  totalOfPayments: 69_434.4,
  budgetFit: { fits: true, under: 10.69 },
};
const promo: Card = {
  label: "promo",
  offerId: "moderate-promo",
  kind: "deferred_interest",
  monthlyPayment: 440.4,
  aprPercent: 15.99,
  termMonths: 180,
  numPayments: 180,
  amountFinanced: 30_000,
  financeCharge: 49_272,
  totalOfPayments: 79_272,
  promo: { months: 12, payoffAmount: 30_000, deferredInterest: 4_409.69 },
  budgetFit: { fits: false, over: 140.4 },
};

describe("OfferCard", () => {
  it("shows every disclosure with the payment (FR-7)", () => {
    render(<OfferCard card={twentyYear} position={2} promoCliff={promoCliff} />);

    expect(screen.getByRole("heading", { name: "2 · Lowest monthly" })).toBeDefined();
    for (const text of ["$289.31", "9.99%", "20 years", "240", "$30,000.00", "$39,434.40", "$69,434.40", "Fits budget · $10.69 under"]) {
      expect(screen.getByText(text)).toBeDefined();
    }
  });

  it("adds the promo conditions and the cliff line", () => {
    render(<OfferCard card={promo} position={3} promoCliff={promoCliff} />);

    expect(screen.getByText(
      "Pay off $30,000.00 within 12 months and the built-up interest isn't charged. If not, $4,409.69 of deferred interest is added.",
    )).toBeDefined();
    expect(screen.getByText("Over budget by $140.40")).toBeDefined();
  });
});
