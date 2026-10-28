// Mock of the existing credit decision engine. The engine decides; the assistant
// only presents and explains. Fixture homeowners stand in for real soft checks.
import type { Offer } from "../domain.js";
import type { DecisionEngine, SoftCheckRequest } from "../ports.js";

type Terms = { years: number; apr: number };

const FIXTURES: Record<string, { fixed: Terms[]; promoApr?: number }> = {
  strong: { fixed: [{ years: 10, apr: 7.99 }, { years: 15, apr: 8.49 }, { years: 20, apr: 8.99 }], promoApr: 14.99 },
  // The worked example used throughout the docs.
  moderate: {
    fixed: [{ years: 10, apr: 8.99 }, { years: 15, apr: 9.49 }, { years: 20, apr: 9.99 }, { years: 25, apr: 12.99 }],
    promoApr: 15.99,
  },
  no_offers: { fixed: [] },
};

export class MockDecisionEngine implements DecisionEngine {
  async softCheck({ applicantRef, amount }: SoftCheckRequest): Promise<Offer[]> {
    const fixture = FIXTURES[applicantRef];
    if (!fixture) throw new Error(`Unknown applicant ${applicantRef}`);
    const offers: Offer[] = fixture.fixed.map(({ years, apr }) => ({
      kind: "fixed",
      id: `${applicantRef}-${years}y`,
      amount,
      aprPercent: apr,
      termMonths: years * 12,
    }));
    if (fixture.promoApr !== undefined) {
      offers.push({
        kind: "deferred_interest",
        id: `${applicantRef}-promo`,
        amount,
        aprPercent: fixture.promoApr,
        termMonths: 180,
        promoMonths: 12,
      });
    }
    return offers;
  }
}
