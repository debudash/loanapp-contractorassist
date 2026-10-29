import { money, projectLabel } from "../format";
import type { SuggestedInputs } from "../types";

export interface Inputs {
  /** Who the quote is for. Shown on screen and kept with the consent; never sent to the model. */
  homeowner: string;
  amount: string;
  budget: string;
  projectType: string;
}

const PROJECT_TYPES = ["roofing", "hvac", "solar", "windows", "other"];

interface Props {
  inputs: Inputs;
  onChange: (inputs: Inputs) => void;
  /** The assistant's pending suggestion; nothing changes until Apply (FR-13). */
  suggestion: SuggestedInputs | null;
  onApply: (inputs: SuggestedInputs) => void;
  onDismiss: () => void;
  /** Compliance-owned hint shown when no budget is given (FR-8). */
  noBudgetHint: string;
}

/** Step 1, and the only place numbers enter a quote (FR-13). Name and budget are optional for the ballpark (FR-8). */
export function InputsPanel({ inputs, onChange, suggestion, onApply, onDismiss, noBudgetHint }: Props) {
  return (
    <section className="panel inputs" aria-label="Project">
      <div className="fields">
        <label>
          Homeowner name
          <input value={inputs.homeowner} placeholder="Maria Lopez" autoComplete="off" maxLength={100}
            onChange={(e) => onChange({ ...inputs, homeowner: e.target.value })} />
        </label>
        <label>
          Project
          <select value={inputs.projectType} onChange={(e) => onChange({ ...inputs, projectType: e.target.value })}>
            {PROJECT_TYPES.map((p) => (
              <option key={p} value={p}>
                {projectLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input inputMode="numeric" value={inputs.amount} placeholder="30000" onChange={(e) => onChange({ ...inputs, amount: e.target.value })} />
        </label>
        <label>
          <span>
            Monthly budget <span className="muted">(optional)</span>
          </span>
          <input inputMode="numeric" value={inputs.budget} placeholder="300" onChange={(e) => onChange({ ...inputs, budget: e.target.value })} />
        </label>
      </div>
      {inputs.budget.trim() === "" && <p className="hint">{noBudgetHint}</p>}
      {suggestion && (
        <div className="suggestion" role="status">
          <span>Suggested: {describe(suggestion)}</span>
          <button type="button" onClick={() => onApply(suggestion)}>
            Apply
          </button>
          <button type="button" className="link" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

function describe(s: SuggestedInputs): string {
  const parts = [
    s.amount !== undefined && `amount ${money(s.amount)}`,
    s.budget !== undefined && `budget ${money(s.budget)}/mo`,
    s.projectType && `project ${s.projectType}`,
  ];
  return parts.filter(Boolean).join(" · ") || "nothing I could read";
}
