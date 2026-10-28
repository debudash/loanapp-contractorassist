// The existing company services the assistant depends on. Mocks in mocks/ and
// the real adapters in production implement the same interfaces.
import type { Offer, Product } from "./domain.js";

/** Loan product catalog plus contractor profile: which products a contractor offers. */
export interface LoanCatalog {
  version: string;
  /** The products this contractor is enrolled to offer. Unknown contractors get none. */
  productsFor(contractorId: string): Product[];
}

/** What the credit engine is given: the applicant and the amount. Never the homeowner's budget. */
export interface SoftCheckRequest {
  applicantRef: string;
  amount: number;
}

/** The credit decision engine. It decides; the assistant only presents and explains. */
export interface DecisionEngine {
  /** A soft check. An empty list means no offers. */
  softCheck(request: SoftCheckRequest): Promise<Offer[]>;
}
