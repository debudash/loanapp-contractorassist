// The screens the evals run on. Each case starts from a fresh session in one of these states.
import { AuditStore } from "../src/audit.js";
import { mockCatalog } from "../src/mocks/catalog.js";
import { MockDecisionEngine } from "../src/mocks/decisionEngine.js";
import { figures, presentOffers, QUOTE_VERSION } from "../src/quote.js";

export type ScenarioName = "offers" | "no_budget" | "declined" | "ballpark";

const SETUP: Record<ScenarioName, { applicantRef?: string; budget?: number }> = {
  offers: { applicantRef: "moderate", budget: 300 },
  no_budget: { applicantRef: "moderate" },
  declined: { applicantRef: "no_offers", budget: 300 },
  ballpark: {},
};

export const SESSION = "eval";
export const CONTRACTOR = "c_summit";

/** A fresh audit store with the scenario's soft check (if any) recorded, plus what the screen shows. */
export async function scenario(name: ScenarioName) {
  const { applicantRef, budget } = SETUP[name];
  const audit = new AuditStore(":memory:");
  audit.createSession(SESSION, CONTRACTOR, mockCatalog.version);
  if (!applicantRef) return { audit, offerSetId: null, cards: [], figures: {} };

  const consentId = audit.recordConsent(SESSION, "eval-consent", "Eval Homeowner");
  const offers = await new MockDecisionEngine().softCheck({ applicantRef, amount: 30_000 });
  const offerSetId = audit.recordOfferSet(
    SESSION,
    consentId,
    { amount: 30_000, budget, applicantRef, catalogVersion: mockCatalog.version, quoteVersion: QUOTE_VERSION },
    offers,
  );
  const cards = presentOffers(offers, budget).cards;
  return { audit, offerSetId, cards, figures: figures(cards, budget) };
}
