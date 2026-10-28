import { useCallback, useEffect, useMemo, useState } from "react";
import { type Api, ApiError, apiFor, type AuditTrail } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Ballpark } from "./components/Ballpark";
import { ComplianceView } from "./components/ComplianceView";
import { type Inputs, InputsPanel } from "./components/InputsPanel";
import { OfferCards } from "./components/OfferCards";
import { SoftCheck } from "./components/SoftCheck";
import type { BallparkResult, ChatMessage, OffersResult, SuggestedInputs, Wording } from "./types";

// Demo contractors; in the portal the signed-in contractor comes from authentication upstream.
const CONTRACTORS = [
  ["c_summit", "Summit Roofing"],
  ["c_valley", "Valley HVAC"],
] as const;

const toNumber = (text: string) => (text.trim() === "" ? undefined : Number(text.replace(/[$,\s]/g, "")));

export function App() {
  const [contractorId, setContractorId] = useState<string>(CONTRACTORS[0][0]);
  const api: Api = useMemo(() => apiFor(contractorId), [contractorId]);
  const [wording, setWording] = useState<Wording | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>({ amount: "30000", budget: "300", projectType: "roofing" });
  const [suggestion, setSuggestion] = useState<SuggestedInputs | null>(null);
  const [ballpark, setBallpark] = useState<BallparkResult | null>(null);
  const [offers, setOffers] = useState<OffersResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompliance, setShowCompliance] = useState(false);
  const [trail, setTrail] = useState<AuditTrail | null>(null);
  const [auditVersion, setAuditVersion] = useState(0); // bumped after every recorded action

  // One error message for the whole page; the cards and figures never depend on the assistant.
  const guarded = useCallback(async (work: () => Promise<void>) => {
    try {
      setError(null);
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? (e.body.message ?? friendly(e.body.error)) : "Something went wrong. Please try again.");
    }
  }, []);

  // A new session per contractor, created by the service; a late answer for the old contractor is ignored.
  useEffect(() => {
    let current = true;
    setSessionId(null);
    setOffers(null);
    setMessages([]);
    setSuggestion(null);
    void guarded(async () => {
      const [{ sessionId: id }, w] = await Promise.all([api.createSession(), api.wording()]);
      if (!current) return;
      setSessionId(id);
      setWording(w);
    });
    return () => {
      current = false;
    };
  }, [api, guarded]);

  const amount = toNumber(inputs.amount);
  const budget = toNumber(inputs.budget);
  const amountValid = amount !== undefined && !Number.isNaN(amount);
  const budgetValid = budget === undefined || budget > 0;

  // The ballpark follows the inputs; answers for older inputs are ignored.
  useEffect(() => {
    if (!sessionId || !amountValid || !budgetValid) return setBallpark(null);
    let current = true;
    const timer = setTimeout(() => {
      api.ballpark(sessionId, amount, budget).then(
        (result) => current && setBallpark(result),
        (e: unknown) => {
          if (!current) return;
          if (e instanceof ApiError && e.body.error === "amount_out_of_range") {
            setBallpark({ ok: false, reason: "amount_out_of_range", min: e.body.min!, max: e.body.max! });
          } else setError("The ballpark is unavailable right now.");
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, sessionId, amount, budget, amountValid, budgetValid]);

  // Offers belong to the amount and budget they were run for; any change takes them off screen.
  useEffect(() => {
    setOffers(null);
  }, [amount, budget]);

  const runSoftCheck = (applicantRef: string) =>
    guarded(async () => {
      if (!sessionId || !amountValid || !budgetValid || !wording) return;
      setOffers(await api.offers(sessionId, amount, budget, applicantRef, wording.version));
      setAuditVersion((v) => v + 1);
    });

  const ask = (message: string) =>
    guarded(async () => {
      if (!sessionId) return;
      setBusy(true);
      try {
        const result = await api.assist(sessionId, message, offers?.offerSetId ?? null);
        setMessages((m) => [...m, { question: message, result }]);
        if (result.kind === "suggestion") setSuggestion(result.inputs);
      } finally {
        setBusy(false);
        setAuditVersion((v) => v + 1);
      }
    });

  // FR-13: the contractor's tap is what changes the inputs.
  const apply = (suggested: SuggestedInputs) => {
    setInputs((current) => ({
      amount: suggested.amount !== undefined ? String(suggested.amount) : current.amount,
      budget: suggested.budget !== undefined ? String(suggested.budget) : current.budget,
      projectType: suggested.projectType ?? current.projectType,
    }));
    setSuggestion(null);
  };

  useEffect(() => {
    if (!showCompliance || !sessionId) return;
    let current = true;
    api.audit(sessionId).then((t) => current && setTrail(t), () => current && setTrail(null));
    return () => {
      current = false;
    };
  }, [showCompliance, sessionId, auditVersion, api]);

  const budgetHint = !budgetValid ? "The monthly budget should be a number above zero." : null;
  const amountHint = !amountValid ? "Enter the project amount to see payments." : null;

  return (
    <div className="page">
      <header className="top">
        <h1>Home improvement financing</h1>
        <div className="top-actions">
          <label>
            Signed in as
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
              {CONTRACTORS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="link" onClick={() => setShowCompliance(!showCompliance)}>
            {showCompliance ? "Hide compliance view" : "Compliance view"}
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <main className="layout">
        <div className="main-column">
          <InputsPanel
            inputs={inputs}
            onChange={setInputs}
            suggestion={suggestion}
            onApply={apply}
            onDismiss={() => setSuggestion(null)}
            noBudgetHint={wording?.uiWording.noBudgetHint ?? ""}
          />
          <Ballpark result={ballpark} hint={amountHint ?? budgetHint} finePrint={wording?.uiWording.ballparkFinePrint ?? ""} />
          {/* Keyed by contractor so a new contractor always starts with consent unticked. */}
          <SoftCheck
            key={contractorId}
            disabled={!sessionId || !amountValid || !budgetValid || !wording}
            consentText={wording?.uiWording.consent ?? ""}
            onRun={runSoftCheck}
          />
          {offers && <OfferCards result={offers} promoCliff={wording?.uiWording.promoCliff ?? ""} />}
          {showCompliance && <ComplianceView trail={trail} />}
        </div>
        <AssistantPanel messages={messages} busy={busy} onAsk={ask} />
      </main>
    </div>
  );
}

function friendly(code: string | undefined): string {
  const messages: Record<string, string> = {
    amount_out_of_range: "That amount is outside the loan range.",
    invalid_budget: "The monthly budget should be a number above zero.",
    soft_check_unavailable: "The soft check is unavailable right now. Please try again.",
  };
  return messages[code ?? ""] ?? "Something went wrong. Please try again.";
}
