import { useState } from "react";
import { fill } from "../format";

// Demo stand-ins for a real application; the mock decision engine has one fixture per path.
export const TEST_PROFILES = [
  ["moderate", "Moderate credit"],
  ["strong", "Strong credit"],
  ["no_offers", "No offers"],
] as const;

interface Props {
  disabled: boolean;
  /** The homeowner's name; a soft check needs one. */
  homeowner: string;
  /** Compliance-owned wording: what to ask the homeowner, and the consent itself (its rules version is recorded). */
  askText: string;
  consentText: string;
  /** The test credit profile; held by App, since a result belongs to the profile it was run for. */
  profile: string;
  onProfileChange: (profile: string) => void;
  onRun: (applicantRef: string) => void;
}

/**
 * Step 3, FR-4, in the order it's done: pick the test profile (demo only), ask permission, tick
 * consent, run. Every soft check needs its own consent tick; it resets after each run and on a new quote.
 */
export function SoftCheck({ disabled, homeowner, askText, consentText, profile, onProfileChange, onRun }: Props) {
  const [consent, setConsent] = useState(false);
  return (
    <section className="panel soft-check" aria-label="Soft check">
      <div className="demo-only">
        <span className="demo-tag">Demo only</span>
        <label>
          Test credit profile
          <select
            value={profile}
            onChange={(e) => {
              onProfileChange(e.target.value);
              setConsent(false);
            }}
          >
            {TEST_PROFILES.map(([ref, name]) => (
              <option key={ref} value={ref}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="fine">The mock lender returns a fixed result for each profile. In the portal, the check uses the homeowner's application.</p>
      </div>
      <p>{fill(askText, { homeowner: homeowner || "the homeowner" })}</p>
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {consentText}
      </label>
      {!homeowner && <p className="hint">Add the homeowner's name in step 1 first.</p>}
      <button
        type="button"
        disabled={!consent || !homeowner || disabled}
        onClick={() => {
          setConsent(false);
          onRun(profile);
        }}
      >
        Run soft check
      </button>
    </section>
  );
}
