import type { AuditTrail } from "../api";

/** FR-15: what the system said and why, straight from the audit tables. */
export function ComplianceView({ trail }: { trail: AuditTrail | null }) {
  if (!trail) return <p className="muted">Loading the audit trail…</p>;
  return (
    <section className="panel compliance" aria-label="Compliance view">
      <h2>Compliance view</h2>
      <p className="muted">
        Session {String(trail.session?.id ?? "")} · catalog {String(trail.session?.catalogVersion ?? "")}
      </p>

      <h3>Consents and soft checks</h3>
      {trail.offerSets.length === 0 && <p className="muted">No soft check yet.</p>}
      <ul>
        {trail.offerSets.map((set) => (
          <li key={String(set.id)}>
            Consent #{String(set.consentId)} → {String(set.offerCount)} offers for {String(set.applicantRef)} · calculator{" "}
            {String(set.quoteVersion)} · {String(set.requestedAt)}
          </li>
        ))}
      </ul>

      <h3>Assistant turns</h3>
      {trail.turns.length === 0 && <p className="muted">No questions yet.</p>}
      {trail.turns.map((turn) => (
        <details key={String(turn.id)}>
          <summary>
            <span className="badge">{String(turn.outcome)}</span> {String(turn.message)}
          </summary>
          <dl>
            <dt>Shown</dt>
            <dd>{String(turn.renderedAnswer ?? "—")}</dd>
            <dt>Said aloud</dt>
            <dd>{String(turn.renderedSay || "—")}</dd>
            <dt>Model drafts (with placeholders)</dt>
            <dd>
              <pre>{JSON.stringify(turn.rawDraft, null, 2)}</pre>
            </dd>
            <dt>Guard results</dt>
            <dd>
              <pre>{JSON.stringify(turn.guardResult, null, 2)}</pre>
            </dd>
            <dt>Meaning check</dt>
            <dd>
              <pre>{JSON.stringify(turn.meaningCheck, null, 2)}</pre>
            </dd>
            <dt>Models and prompts</dt>
            <dd>
              <pre>{JSON.stringify({ models: turn.models, prompts: turn.promptVersions, rules: turn.rulesVersion }, null, 2)}</pre>
            </dd>
            <dt>Cost and time</dt>
            <dd>
              {String(turn.inputTokens)} tokens in, {String(turn.outputTokens)} out · {String(turn.latencyMs)} ms
            </dd>
          </dl>
        </details>
      ))}

      {trail.escalations.length > 0 && (
        <>
          <h3>Escalations</h3>
          <ul>
            {trail.escalations.map((e) => (
              <li key={String(e.id)}>
                {String(e.ticketRef ?? "ticket failed")}: turn {String(e.turnId)} · {String(e.reason)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
