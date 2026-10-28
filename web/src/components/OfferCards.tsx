import { useState } from "react";
import { CARD_TITLES, fill, money, years } from "../format";
import type { Card, DisclosedOffer, OffersResult } from "../types";

/**
 * One offer with every disclosure (FR-7). Cards share a fixed order and no emphasis but the
 * budget label (FR-6, NG-3); they're numbered so the contractor can say "compare 1 and 2".
 */
export function OfferCard({ card, position, promoCliff }: { card: Card; position: number; promoCliff: string }) {
  return (
    <article className="offer">
      <header>
        <h3 className="label">
          {position} · {CARD_TITLES[card.label]}
        </h3>
        <BudgetChip offer={card} />
      </header>
      <div className="pay">
        {money(card.monthlyPayment)}
        <small> /mo</small>
      </div>
      <dl>
        <dt>APR</dt>
        <dd>{card.aprPercent}%</dd>
        <dt>Term</dt>
        <dd>{years(card.termMonths)}</dd>
        <dt>Payments</dt>
        <dd>{card.numPayments}</dd>
        <dt>Amount financed</dt>
        <dd>{money(card.amountFinanced)}</dd>
        <dt>Finance charge</dt>
        <dd>{money(card.financeCharge)}</dd>
        <dt>Total of payments</dt>
        <dd>{money(card.totalOfPayments)}</dd>
      </dl>
      {card.promo && <p className="cliff">{cliffText(card, promoCliff)}</p>}
    </article>
  );
}

function cliffText(offer: DisclosedOffer, promoCliff: string): string {
  if (!offer.promo) return "—";
  return fill(promoCliff, { payoff: money(offer.promo.payoffAmount), months: offer.promo.months, cliff: money(offer.promo.deferredInterest) });
}

function BudgetChip({ offer }: { offer: DisclosedOffer }) {
  if (!offer.budgetFit) return null;
  return offer.budgetFit.fits ? (
    <span className="chip ok">Fits budget · {money(offer.budgetFit.under)} under</span>
  ) : (
    <span className="chip no">Over budget by {money(offer.budgetFit.over)}</span>
  );
}

/** The three cards, the no-offers notice, and "See all N offers" with the same disclosures. */
export function OfferCards({ result, promoCliff }: { result: OffersResult; promoCliff: string }) {
  const [showAll, setShowAll] = useState(false);
  if (result.noOffers) return <p className="notice">{result.message}</p>;
  return (
    <section className="offers-block" aria-label="Offers">
      <div className="offers">
        {result.cards.map((card, i) => (
          <OfferCard key={card.offerId} card={card} position={i + 1} promoCliff={promoCliff} />
        ))}
      </div>
      <button type="button" className="link" onClick={() => setShowAll(!showAll)}>
        {showAll ? "Hide the full list" : `See all ${result.totalCount} offers`}
      </button>
      {showAll && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Monthly</th>
                <th>APR</th>
                <th>Term</th>
                <th>Payments</th>
                <th>Amount financed</th>
                <th>Finance charge</th>
                <th>Total of payments</th>
                <th>Promo</th>
              </tr>
            </thead>
            <tbody>
              {result.allOffers.map((o) => (
                <tr key={o.offerId}>
                  <td>{money(o.monthlyPayment)}</td>
                  <td>{o.aprPercent}%</td>
                  <td>{years(o.termMonths)}</td>
                  <td>{o.numPayments}</td>
                  <td>{money(o.amountFinanced)}</td>
                  <td>{money(o.financeCharge)}</td>
                  <td>{money(o.totalOfPayments)}</td>
                  <td>{cliffText(o, promoCliff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
