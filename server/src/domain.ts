// Shared shapes for the quote engine. Mirrors what the loan catalog and the
// credit decision engine return; the mocks and real services share them.

/** A fixed-rate loan product. The APR depends on credit, so the catalog gives a range. */
export interface FixedProduct {
  kind: "fixed";
  id: string;
  name: string;
  termMonths: number;
  aprMin: number;
  aprMax: number;
  /** Plain-language terms approved by compliance (FR-10a). */
  termsText: string;
}

/** A deferred-interest promo product. promoMonths is required, so a promo can't exist without its cliff. */
export interface PromoProduct extends Omit<FixedProduct, "kind"> {
  kind: "deferred_interest";
  promoMonths: number;
}

export type Product = FixedProduct | PromoProduct;

/** A real offer from the credit decision engine after a soft check. The engine decides; we only present. */
export interface FixedOffer {
  kind: "fixed";
  id: string;
  amount: number;
  aprPercent: number;
  termMonths: number;
}

export interface PromoOffer extends Omit<FixedOffer, "kind"> {
  kind: "deferred_interest";
  promoMonths: number;
}

export type Offer = FixedOffer | PromoOffer;
