// The assist pipeline: a fixed path, not an agent loop (docs/architecture.md 3.3, 3.4).
// Lane 1: new numbers become suggestions the contractor applies. Lane 2: questions
// get an explanation that passes the guard and the meaning check, or a standard
// explanation written in code. Risky questions get fixed wording from the rules file.
import { type AuditStore, blankTurn, type TurnRecord } from "./audit.js";
import rulesFile from "./compliance-rules.json" with { type: "json" };
import { type Draft, type Failure, guard } from "./guard.js";
import { checkInputs, type SuggestedInputs } from "./inputs.js";
import { type MeaningVerdict, type Model, ModelUnavailable, type Step, type Usage } from "./model.js";
import type { LoanCatalog } from "./ports.js";
import { PROMPT_VERSIONS } from "./prompts.js";
import { type Card, CARD_TITLES, type Figures, figures as figuresFor, presentOffers } from "./quote.js";
import { render } from "./render.js";

export interface AssistDeps {
  model: Model;
  audit: AuditStore;
  catalog: LoanCatalog;
  /** Raises a compliance ticket (Zapier to JSM in production) and returns its reference. */
  escalate: (turnId: number, reason: string) => string;
  /** Whole-question deadline across every model call; calls still running are cancelled (F-4, FR-16). */
  deadlineMs?: number;
}

export type AssistResult =
  | { kind: "suggestion"; inputs: SuggestedInputs; dropped: string[] }
  | { kind: "answer"; outcome: "answered" | "standard_explanation" | "redirected"; answer: string; say: string }
  | { kind: "unavailable"; message: string };

/** One explain attempt: the draft, the rule checks, and the meaning check if the rules passed. */
interface Attempt {
  draft: Draft;
  guardResult: { pass: boolean; failures: Failure[] };
  verdict: MeaningVerdict | null;
}

const UNAVAILABLE = "The assistant is unavailable right now. The cards and figures on screen are unaffected.";
const WORDING = rulesFile.fixedWording;
const HISTORY_TURNS = 4;
const MAX_ATTEMPTS = 2;
const DEADLINE_MS = 20_000;

export async function assist(
  request: {
    sessionId: string;
    contractorId: string;
    message: string;
    /** The offer set on screen; null when none is shown; omitted means the latest. */
    offerSetId?: number | null;
  },
  deps: AssistDeps,
): Promise<AssistResult> {
  const started = Date.now();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deps.deadlineMs ?? DEADLINE_MS);
  const screen = currentScreen(request.sessionId, request.contractorId, request.offerSetId, deps);
  const attempts: Attempt[] = [];
  const stepsRun = new Set<Step>();
  let route: TurnRecord["route"] = "question";

  /** Counts a call's tokens and notes which step ran, for the audit record. */
  const spend = <T>(step: Step, call: { value: T; usage: Usage }): T => {
    stepsRun.add(step);
    usage.inputTokens += call.usage.inputTokens;
    usage.outputTokens += call.usage.outputTokens;
    return call.value;
  };
  const onlyStepsRun = (byStep: Record<Step, string>) =>
    Object.fromEntries([...stepsRun].map((step) => [step, byStep[step]]));
  // Every turn records the same context; callers add only what happened.
  const record = (outcome: TurnRecord["outcome"], fields: Partial<TurnRecord> = {}) =>
    deps.audit.recordTurn({
      ...blankTurn({ sessionId: request.sessionId, contractorId: request.contractorId, message: request.message,
                     catalogVersion: deps.catalog.version, route, outcome }),
      offerSetId: screen.offerSetId,
      offersOnScreen: screen.cards.map((c) => c.offerId),
      models: onlyStepsRun(deps.model.names),
      promptVersions: onlyStepsRun(PROMPT_VERSIONS),
      rulesVersion: rulesFile.version,
      rawDraft: attempts.map((a) => a.draft),
      guardResult: attempts.map((a) => a.guardResult),
      meaningCheck: attempts.map((a) => a.verdict),
      attempts: attempts.length,
      ...fields,
      ...usage,
      latencyMs: Date.now() - started,
    });
  const fixed = (answer: string): AssistResult => {
    record("redirected", { renderedAnswer: answer, renderedSay: "" });
    return { kind: "answer", outcome: "redirected", answer, say: "" };
  };

  try {
    const understood = spend("understand", await deps.model.understand(request.message, deadline.signal));

    if (understood.kind === "inputs") {
      // Lane 1 (FR-13, G-5): only numbers the contractor typed; nothing reruns until they tap Apply.
      route = "inputs";
      const { inputs, dropped } = checkInputs(request.message, understood.inputs);
      record("suggested", { suggestedInputs: { inputs, dropped } });
      return { kind: "suggestion", inputs, dropped };
    }
    if (understood.kind === "off_topic") return fixed(WORDING.offTopic);
    // NG-2: after a decline, no question gets the model's words, and none hints at offers.
    if (screen.declined) return fixed(WORDING.noOffers);
    if (understood.kind === "credit_decision") {
      return fixed(screen.cards.length ? WORDING.creditDecisionAfterOffers : WORDING.creditDecisionBeforeOffers);
    }

    // Lane 2: explain and check; one retry with the reasons.
    const history = deps.audit.recentDrafts(request.sessionId, screen.offerSetId, HISTORY_TURNS);
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const last = attempts[attempts.length - 1];
      const draft = spend("explain", await deps.model.explain(
        { question: request.message, cards: screen.cards, figures: screen.figures, termsTexts: screen.termsTexts,
          history, retryReasons: last ? retryReasons(last) : [] },
        deadline.signal,
      ));
      // Recorded before the meaning check, so a deadline during the check keeps the draft.
      const attempt: Attempt = { draft, guardResult: guard(draft, screen), verdict: null };
      attempts.push(attempt);
      if (attempt.guardResult.pass) {
        const check = { draft, termsTexts: screen.termsTexts, figures: screen.figures };
        attempt.verdict = spend("check", await deps.model.meaningCheck(check, deadline.signal));
      }
      if (attempt.guardResult.pass && attempt.verdict?.pass) {
        const answer = render(attempt.draft.answer, screen.figures);
        const say = render(attempt.draft.say, screen.figures);
        record("answered", { renderedAnswer: answer, renderedSay: say });
        return { kind: "answer", outcome: "answered", answer, say };
      }
    }

    // F-2: both drafts failed. Show fixed wording built from the figures and raise a ticket.
    const answer = standardExplanation(screen.cards, screen.figures, screen.termsTexts);
    const turnId = record("standard_explanation", { renderedAnswer: answer, renderedSay: "" });
    const reason = `Both drafts failed: ${attempts.flatMap(retryReasons).join("; ")}`;
    deps.audit.recordEscalation(turnId, reason, raiseTicket(deps, turnId, reason));
    return { kind: "answer", outcome: "standard_explanation", answer, say: "" };
  } catch (error) {
    // Every turn is recorded (FR-14). Only the model failing is "unavailable" to the
    // contractor (F-4); anything else is a defect and surfaces.
    record("unavailable");
    if (!(error instanceof ModelUnavailable)) throw error;
    return { kind: "unavailable", message: UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}

/** The ticket reference, or null if raising it failed. A failed ticket never blocks the contractor's answer. */
function raiseTicket(deps: AssistDeps, turnId: number, reason: string): string | null {
  try {
    return deps.escalate(turnId, reason);
  } catch (error) {
    console.error(`[escalation] could not raise a ticket for turn ${turnId}:`, error);
    return null;
  }
}

/** Why an attempt was rejected, in words the model can act on. */
function retryReasons(attempt: Attempt): string[] {
  if (!attempt.guardResult.pass) return attempt.guardResult.failures.map((f) => `${f.rule} ${f.reason}: "${f.quote}"`);
  if (attempt.verdict && !attempt.verdict.pass) return [`meaning check: ${attempt.verdict.reason} ("${attempt.verdict.quote}")`];
  return [];
}

/** What is on screen for this session: the cards from the latest soft check, their figures and terms text. */
function currentScreen(sessionId: string, contractorId: string, offerSetId: number | null | undefined, deps: AssistDeps) {
  const offerSet =
    offerSetId === null ? undefined : offerSetId === undefined ? deps.audit.latestOfferSet(sessionId) : deps.audit.offerSet(sessionId, offerSetId);
  const cards = offerSet ? presentOffers(offerSet.offers, offerSet.budget).cards : [];
  const products = deps.catalog.productsFor(contractorId);
  const kinds = new Set(cards.length ? cards.map((c) => c.kind) : products.map((p) => p.kind));
  const termsTexts = [...kinds].map((kind) => products.find((p) => p.kind === kind)?.termsText).filter((t): t is string => !!t);
  return {
    offerSetId: offerSet?.id ?? null,
    declined: offerSet !== undefined && offerSet.offers.length === 0,
    cards,
    figures: figuresFor(cards, offerSet?.budget),
    promoOnScreen: cards.some((c) => c.kind === "deferred_interest"),
    termsTexts,
  };
}

/** F-2 fallback: every card's key figures and the approved terms, in fixed wording. */
function standardExplanation(cards: Card[], figures: Figures, termsTexts: string[]): string {
  if (cards.length === 0) return termsTexts.join(" ");
  return cards
    .map((c) => {
      const f = (name: string) => figures[`${c.label}.${name}`];
      const line = `${CARD_TITLES[c.label]}: ${f("monthly")} a month for ${f("term_years")} years at ${f("apr")} APR, ${f("total")} in total.`;
      return c.promo
        ? `${line} Pay off ${f("payoff")} within ${f("months")} months, or ${f("cliff")} of deferred interest is added.`
        : line;
    })
    .join("\n");
}
