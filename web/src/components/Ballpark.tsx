import { fill, money, years } from "../format";
import type { BallparkResult } from "../types";

const FIT_LABELS = {
  fits_any_rate: { className: "ok", text: "Fits at any rate" },
  fits_some_rates: { className: "some", text: "Fits at some rates" },
  does_not_fit: { className: "no", text: "Doesn't fit" },
} as const;

/** FR-1, FR-2: a range per term, no homeowner data, no AI. The fine print is compliance-owned wording. */
export function Ballpark({ result, hint, finePrint }: { result: BallparkResult | null; hint: string | null; finePrint: string }) {
  if (hint) return <p className="notice">{hint}</p>;
  if (!result) return null;
  if (!result.ok) {
    return (
      <p className="notice">
        {result.reason === "amount_out_of_range"
          ? `Loans run from ${money(result.min)} to ${money(result.max)}.`
          : "You aren't set up to offer any fixed-rate products yet."}
      </p>
    );
  }
  const hasBudget = result.rows.some((r) => r.fit);
  return (
    <section className="panel" aria-label="Ballpark">
      <h2>Ballpark</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Monthly payment range</th>
              {hasBudget && <th>Against her budget</th>}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.termMonths}>
                <td>{years(r.termMonths)}</td>
                <td>
                  {money(r.monthlyLow)} – {money(r.monthlyHigh)}
                </td>
                {hasBudget && r.fit && (
                  <td>
                    <span className={`chip ${FIT_LABELS[r.fit].className}`}>{FIT_LABELS[r.fit].text}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">{fill(finePrint, { aprMin: result.aprMin, aprMax: result.aprMax })}</p>
    </section>
  );
}
