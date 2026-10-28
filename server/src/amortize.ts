/** Rounds a dollar amount to cents. */
export function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function monthlyRate(aprPercent: number): number {
  return aprPercent / 100 / 12;
}

/** Standard fixed-rate monthly payment, rounded to cents. */
export function monthlyPayment(amount: number, aprPercent: number, termMonths: number): number {
  const r = monthlyRate(aprPercent);
  if (r === 0) return cents(amount / termMonths);
  return cents((amount * r) / (1 - (1 + r) ** -termMonths));
}

/**
 * Deferred interest added if a promo balance isn't paid off in time (A-6).
 * During the promo no interest is charged, so each payment reduces principal;
 * interest still builds on that falling principal and is all added at the end.
 * Our modelling assumption: the brief doesn't define the calculation.
 */
export function deferredInterestOwed(amount: number, aprPercent: number, payment: number, promoMonths: number): number {
  const r = monthlyRate(aprPercent);
  let principal = amount;
  let accrued = 0;
  for (let month = 0; month < promoMonths && principal > 0; month++) {
    accrued += principal * r;
    principal -= payment;
  }
  return cents(accrued);
}
