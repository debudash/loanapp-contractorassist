// Mock of the existing loan product catalog and contractor profile services.
// Same interface the real adapters would implement; the data is our assumption (PRD A-1).
import type { Product } from "../domain.js";
import type { LoanCatalog } from "../ports.js";

const FIXED_TERMS =
  "Fixed rate: the APR and the monthly payment stay the same for the whole term. There is no penalty for paying early.";
const DEFERRED_INTEREST_TERMS =
  "Deferred interest: interest builds up from the start but is not charged if the full amount financed is paid off " +
  "within the promo period. If any balance remains when the promo period ends, all of the built-up interest is added " +
  "to the balance. Regular monthly payments are due throughout.";

const fixed = (years: number): Product => ({
  kind: "fixed",
  id: `fixed-${years}y`,
  name: `Fixed ${years}-year`,
  termMonths: years * 12,
  aprMin: 7.99,
  aprMax: 17.99,
  termsText: FIXED_TERMS,
});

const PRODUCTS: Product[] = [
  fixed(5),
  fixed(10),
  fixed(15),
  fixed(20),
  fixed(25),
  {
    kind: "deferred_interest",
    id: "promo-12m",
    name: "12 months deferred interest",
    termMonths: 180,
    aprMin: 14.99,
    aprMax: 24.99,
    promoMonths: 12,
    termsText: DEFERRED_INTEREST_TERMS,
  },
];

const ENROLMENT: Record<string, string[]> = {
  c_summit: PRODUCTS.map((p) => p.id), // Summit Roofing: everything
  c_valley: ["fixed-5y", "fixed-10y"], // Valley HVAC: short fixed terms only
};

export const mockCatalog: LoanCatalog = {
  version: "cat-2026-10",
  productsFor: (contractorId) => PRODUCTS.filter((p) => ENROLMENT[contractorId]?.includes(p.id)),
};

