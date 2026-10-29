import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type Api, ApiError, apiFor, type AuditTrail } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Ballpark } from "./components/Ballpark";
import { ComplianceView } from "./components/ComplianceView";
import { type Inputs, InputsPanel } from "./components/InputsPanel";
import { OfferCards } from "./components/OfferCards";
import { SoftCheck } from "./components/SoftCheck";
import { money, projectLabel } from "./format";
import type { BallparkResult, ChatMessage, OffersResult, SuggestedInputs, Wording } from "./types";

// Demo contractors; in the portal the signed-in contractor comes from authentication upstream.
const CONTRACTORS = [
  ["c_summit", "Summit Roofing"],
  ["c_valley", "Valley HVAC"],
] as const;

// The first quote is filled in so the demo shows a ballpark straight away; a new quote starts blank.
const DEMO_INPUTS: Inputs = { homeowner: "", amount: "30000", budget: "300", projectType: "roofing" };
const BLANK_INPUTS: Inputs = { homeowner: "", amount: "", budget: "", projectType: "roofing" };

const toNumber = (text: string) => (text.trim() === "" ? undefined : Number(text.replace(/[$,\s]/g, "")));

export function App() {
  const [contractorId, setContractorId] = useState<string>(CONTRACTORS[0][0]);
  const api: Api = useMemo(() => apiFor(contractorId), [contractorId]);
  const [quoteNumber, setQuoteNumber] = useState(0); // bumped by "Start new quote"
  const [wording, setWording] = useState<Wording | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>(DEMO_INPUTS);
  const [suggestion, setSuggestion] = useState<SuggestedInputs | null>(null);
  const [ballpark, setBallpark] = useState<BallparkResult | null>(null);
  const [offers, setOffers] = useState<OffersResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"quote" | "compliance">("quote");
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

  // A new session per contractor and per quote, created by the service; a late answer for an old one is ignored.
  useEffect(() => {
    let current = true;
    setSessionId(null);
    setOffers(null);
    setMessages([]);
    setSuggestion(null);
    setTrail(null);
    void guarded(async () => {
      const [{ sessionId: id }, w] = await Promise.all([api.createSession(), api.wording()]);
      if (!current) return;
      setSessionId(id);
      setWording(w);
    });
    return () => {
      current = false;
    };
  }, [api, quoteNumber, guarded]);

  const amount = toNumber(inputs.amount);
  const budget = toNumber(inputs.budget);
  const amountValid = amount !== undefined && !Number.isNaN(amount);
  const budgetValid = budget === undefined || budget > 0;
  const homeowner = inputs.homeowner.trim();
  const who = homeowner || "the homeowner";
  const hasOffers = offers !== null && !offers.noOffers;

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

  // Offers belong to the amount, budget and homeowner they were run for; any change takes them off screen.
  useEffect(() => {
    setOffers(null);
  }, [amount, budget, homeowner]);

  const runSoftCheck = (applicantRef: string) =>
    guarded(async () => {
      if (!sessionId || !amountValid || !budgetValid || !wording || !homeowner) return;
      setOffers(await api.offers(sessionId, amount, budget, applicantRef, wording.version, homeowner));
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
      ...current,
      amount: suggested.amount !== undefined ? String(suggested.amount) : current.amount,
      budget: suggested.budget !== undefined ? String(suggested.budget) : current.budget,
      projectType: suggested.projectType ?? current.projectType,
    }));
    setSuggestion(null);
  };

  const startNewQuote = () => {
    setInputs(BLANK_INPUTS);
    setAssistantOpen(false);
    setQuoteNumber((n) => n + 1);
  };

  useEffect(() => {
    if (view !== "compliance" || !sessionId) return;
    let current = true;
    api.audit(sessionId).then((t) => current && setTrail(t), () => current && setTrail(null));
    return () => {
      current = false;
    };
  }, [view, sessionId, auditVersion, api]);

  const budgetHint = !budgetValid ? "The monthly budget should be a number above zero." : null;
  const amountHint = !amountValid ? "Enter the project amount to see payments." : null;

  // The step the contractor is on, and what to do there.
  // The ballpark is done as soon as it shows, so the contractor moves straight on to step 3.
  const step = !amountValid || !ballpark?.ok ? 1 : hasOffers ? 4 : 3;
  const next =
    step === 1 ? "enter the project amount to see a ballpark."
    : step === 4 ? `walk ${who} through the offers. Need help explaining? Ask the assistant.`
    : offers?.noOffers ? "no offers came back from this check. See the note in step 3."
    : homeowner ? `share the ballpark with ${who}. When ${who} wants real offers, ask for permission in step 3.`
    : "share the ballpark. For real offers, add the homeowner's name in step 1, then ask for permission in step 3.";

  const labels = new Set(offers?.cards.map((c) => c.label));
  // Before offers the assistant has nothing to explain, so the starter shows typing numbers the way homeowners talk.
  const starters = !offers
    ? ["$25K roof, they can do $250 a month"]
    : offers.noOffers
      ? []
      : [
          labels.has("lowest_total") && labels.has("lowest_monthly") && "Why does the lower payment cost more overall?",
          labels.has("promo") && "Explain the promo",
          "What does the finance charge mean?",
        ].filter((q): q is string => Boolean(q));

  const contractorName = CONTRACTORS.find(([id]) => id === contractorId)?.[1] ?? contractorId;

  return (
    <div className="page">
      <header className="top">
        <h1>Home improvement financing</h1>
        <div className="top-actions">
          <label>
            Signed in as
            <select
              value={contractorId}
              onChange={(e) => {
                setContractorId(e.target.value);
                setInputs((current) => ({ ...current, homeowner: "" })); // another contractor's quote is for someone else
              }}
            >
              {CONTRACTORS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {view === "quote" && (
            <button type="button" className="link" onClick={() => setView("compliance")}>
              Compliance view
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view === "compliance" ? (
        <ComplianceView trail={trail} contractorName={contractorName} onBack={() => setView("quote")} />
      ) : (
        <>
          <div className="quote-bar">
            <span>
              <strong>Quote for {who}</strong> · {projectLabel(inputs.projectType)} · {amountValid ? money(amount) : "amount not set"}
            </span>
            <button type="button" className="link" onClick={startNewQuote}>
              Start new quote
            </button>
          </div>
          <p className="next">{`Next: ${next}`}</p>

          <main className="layout">
            <div className="main-column">
              <Step n={1} title="Project" current={step}>
                <InputsPanel
                  inputs={inputs}
                  onChange={setInputs}
                  suggestion={suggestion}
                  onApply={apply}
                  onDismiss={() => setSuggestion(null)}
                  noBudgetHint={wording?.uiWording.noBudgetHint ?? ""}
                />
              </Step>
              <Step n={2} title="Ballpark" current={step}>
                <Ballpark
                  result={ballpark}
                  hint={amountHint ?? budgetHint}
                  note={wording?.uiWording.ballparkNote ?? ""}
                  finePrint={wording?.uiWording.ballparkFinePrint ?? ""}
                  homeowner={homeowner}
                />
              </Step>
              <Step n={3} title="Real offers" current={step}>
                {/* Keyed by contractor and quote so each new quote starts with consent unticked. */}
                <SoftCheck
                  key={`${contractorId}-${quoteNumber}`}
                  disabled={!sessionId || !amountValid || !budgetValid || !wording}
                  homeowner={homeowner}
                  askText={wording?.uiWording.softCheckAsk ?? ""}
                  consentText={wording?.uiWording.consent ?? ""}
                  onRun={runSoftCheck}
                />
                {offers?.noOffers && <OfferCards result={offers} promoCliff="" />}
              </Step>
              <Step n={4} title={`Offers for ${who}`} current={step}>
                {hasOffers ? (
                  <>
                    <OfferCards result={offers} promoCliff={wording?.uiWording.promoCliff ?? ""} />
                    <button type="button" className="link help" onClick={() => setAssistantOpen(true)}>
                      Need help explaining? Ask the assistant
                    </button>
                  </>
                ) : (
                  <p className="muted">Run the soft check to see real offers.</p>
                )}
              </Step>
            </div>
            <AssistantPanel
              messages={messages}
              busy={busy}
              onAsk={ask}
              open={assistantOpen}
              onOpenChange={setAssistantOpen}
              starters={starters}
            />
          </main>
        </>
      )}
    </div>
  );
}

/** One numbered step: ticked once the contractor is past it, highlighted while they're on it. */
function Step({ n, title, current, children }: { n: number; title: string; current: number; children: ReactNode }) {
  const state = n < current ? "done" : n === current ? "current" : "upcoming";
  return (
    <section className={`step ${state}`} aria-labelledby={`step-${n}`} aria-current={state === "current" ? "step" : undefined}>
      <h2 id={`step-${n}`}>
        <span className="step-n" aria-hidden="true">
          {state === "done" ? "✓" : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function friendly(code: string | undefined): string {
  const messages: Record<string, string> = {
    amount_out_of_range: "That amount is outside the loan range.",
    invalid_budget: "The monthly budget should be a number above zero.",
    soft_check_unavailable: "The soft check is unavailable right now. Please try again.",
    homeowner_name_required: "Add the homeowner's name before the soft check.",
  };
  return messages[code ?? ""] ?? "Something went wrong. Please try again.";
}
