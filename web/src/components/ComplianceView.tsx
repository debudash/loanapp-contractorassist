import type { AuditTrail } from "../api";
import { type Check, checks, timeline } from "../auditSummary";

const ICONS: Record<Check["status"], string> = { ok: "✓", warn: "⚠", fail: "✗", none: "–" };

interface Props {
  trail: AuditTrail | null;
  contractorName: string;
  onBack: () => void;
}

/**
 * FR-15: a back-office page for one quote, from the append-only audit tables. It answers what a
 * reviewer asks: was there consent before the credit check, what was shown and said, did every
 * AI answer pass the checks and what was blocked, and which rules, models and prompts produced it.
 */
export function ComplianceView({ trail, contractorName, onBack }: Props) {
  return (
    <section className="panel compliance" aria-label="Compliance view">
      <div className="compliance-head">
        <h2>Compliance view</h2>
        <button type="button" className="link" onClick={onBack}>
          Back to the quote
        </button>
      </div>
      <p className="muted">What the system showed and why, for one quote. Read-only: the audit trail can't be changed.</p>
      {trail ? <Trail trail={trail} contractorName={contractorName} /> : <p className="muted">Loading the audit trail…</p>}
    </section>
  );
}

function Trail({ trail, contractorName }: { trail: AuditTrail; contractorName: string }) {
  const name = trail.consents.at(-1)?.homeownerName;
  return (
    <>
      <div>
        <h3>
          {name ? `Quote for ${String(name)}` : "Quote (no soft check yet)"} · {contractorName}
        </h3>
        <p className="muted">
          Session {String(trail.session?.id ?? "")} · started {time(String(trail.session?.startedAt ?? ""))}
        </p>
      </div>

      <ul className="checks">
        {checks(trail).map((c) => (
          <li key={c.text} className={c.status}>
            <span aria-hidden="true">{ICONS[c.status]}</span> {c.text}
          </li>
        ))}
      </ul>

      <h3>Timeline</h3>
      <ol className="timeline">
        {timeline(trail).map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <time dateTime={e.at}>{time(e.at)}</time>
            <div>
              <strong>{e.title}</strong>
              {e.details.map((d) => (
                <p key={d} className="muted">
                  {d}
                </p>
              ))}
              {e.drafts?.map((d) => (
                <div key={d.label} className="draft">
                  <span className={d.blocked ? "badge blocked" : "badge"}>{d.label}</span>
                  {d.checks.map((c) => (
                    <span key={c.name} className={`check ${c.ok === false ? "fail" : c.ok ? "ok" : "none"}`}>
                      {c.name} {c.ok === null ? "not run" : c.ok ? "✓" : "✗"}
                    </span>
                  ))}
                  {d.checks.filter((c) => c.why).map((c) => (
                    <p key={c.name} className="why">
                      {c.name}: {c.why}
                    </p>
                  ))}
                </div>
              ))}
              {e.shown && (
                <p>
                  <span className="muted">Shown:</span> {e.shown}
                </p>
              )}
              {e.said && (
                <p>
                  <span className="muted">Said aloud:</span> {e.said}
                </p>
              )}
              {e.outcome && <p className="outcome">{e.outcome}</p>}
              <details>
                <summary>Technical record</summary>
                <pre>{JSON.stringify(e.record, null, 2)}</pre>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function time(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
