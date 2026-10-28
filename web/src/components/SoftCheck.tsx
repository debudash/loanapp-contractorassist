import { useState } from "react";

// Demo stand-ins for a real homeowner; the mock decision engine has one fixture per path.
const DEMO_HOMEOWNERS = [
  ["moderate", "Homeowner A (moderate credit)"],
  ["strong", "Homeowner B (strong credit)"],
  ["no_offers", "Homeowner C (no offers)"],
] as const;

interface Props {
  disabled: boolean;
  /** Compliance-owned consent wording; its rules version is recorded with the consent. */
  consentText: string;
  onRun: (applicantRef: string) => void;
}

/** FR-4: every soft check needs its own consent tick. It resets after each run and on a new homeowner. */
export function SoftCheck({ disabled, consentText, onRun }: Props) {
  const [consent, setConsent] = useState(false);
  const [applicant, setApplicant] = useState<string>(DEMO_HOMEOWNERS[0][0]);
  return (
    <section className="panel soft-check" aria-label="Real offers">
      <h2>Real offers</h2>
      <label>
        Demo homeowner
        <select
          value={applicant}
          onChange={(e) => {
            setApplicant(e.target.value);
            setConsent(false);
          }}
        >
          {DEMO_HOMEOWNERS.map(([ref, name]) => (
            <option key={ref} value={ref}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {consentText}
      </label>
      <button
        type="button"
        disabled={!consent || disabled}
        onClick={() => {
          setConsent(false);
          onRun(applicant);
        }}
      >
        Run soft check
      </button>
    </section>
  );
}
