// The compliance view's reading of the audit trail: the plain checks a reviewer asks
// about every quote, and a timeline of what happened. Read-only, from the rows as recorded.
import type { AuditTrail } from "./api";
import { money } from "./format";

export interface Check {
  status: "ok" | "warn" | "fail" | "none";
  text: string;
}

export interface DraftCheck {
  name: string;
  /** null: not run, because the guard had already blocked the draft. */
  ok: boolean | null;
  why?: string;
}

export interface TimelineEvent {
  at: string;
  title: string;
  details: string[];
  shown?: string;
  said?: string;
  drafts?: { label: string; blocked: boolean; checks: DraftCheck[] }[];
  outcome?: string;
  /** The row behind this event, for the technical record. */
  record: unknown;
}

interface Failure {
  rule: string;
  reason: string;
  quote: string;
}

/** The turn fields the view reads, as the audit API returns them. */
interface Turn {
  id: number;
  createdAt: string;
  message: string;
  outcome: string;
  renderedAnswer: string | null;
  renderedSay: string | null;
  suggestedInputs: { amount?: number; budget?: number; projectType?: string } | null;
  guardResult: { pass: boolean; failures: Failure[] }[] | null;
  meaningCheck: ({ pass: boolean; quote?: string; reason?: string } | null)[] | null;
  models: Record<string, string> | null;
  promptVersions: Record<string, string> | null;
  rulesVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  offersOnScreen: string[] | null;
}

/** The guard's rules (server/src/guard.ts), named for a reviewer. A rule not listed here shows under its ID. */
const GUARD_RULES = [
  ["G-1", "Numbers"],
  ["G-2", "Decisions"],
  ["G-3", "Marketing"],
  ["G-4", "Spoken disclosures"],
] as const;

const turnsOf = (trail: AuditTrail) => trail.turns as unknown as Turn[];
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each draft the model wrote for a turn, with its guard result and meaning check. */
function attempts(turn: Turn) {
  const verdicts = turn.meaningCheck ?? [];
  return (turn.guardResult ?? []).map((guard, i) => ({ guard, verdict: verdicts[i] ?? null }));
}
type Attempt = ReturnType<typeof attempts>[number];
const blocked = (a: Attempt) => !a.guard.pass || a.verdict?.pass !== true;

export function checks(trail: AuditTrail): Check[] {
  const out: Check[] = [];

  const givenAt = new Map(trail.consents.map((c) => [c.id, String(c.givenAt)]));
  const sets = trail.offerSets;
  if (sets.length === 0) out.push({ status: "none", text: "No soft check run" });
  else {
    const consented = sets.filter((s) => {
      const at = givenAt.get(s.consentId);
      return at !== undefined && at <= String(s.requestedAt);
    }).length;
    out.push(
      consented === sets.length
        ? { status: "ok", text: `Consent recorded before every soft check (${consented} of ${sets.length})` }
        : { status: "fail", text: `Soft check without consent before it (${consented} of ${sets.length} had consent)` },
    );
  }

  const turns = turnsOf(trail);
  if (turns.length === 0) {
    out.push({ status: "none", text: "No questions asked" });
    return out;
  }

  const answered = turns.filter((t) => t.outcome === "answered");
  const unchecked = answered.filter((t) => attempts(t).every(blocked)).length;
  if (unchecked > 0) out.push({ status: "fail", text: `${count(unchecked, "AI answer")} shown without passing every check` });
  else if (answered.length === 1) {
    out.push({ status: "ok", text: "1 AI answer shown, and it passed every check, so every figure in it came from the calculator" });
  } else if (answered.length > 1) {
    out.push({
      status: "ok",
      text: `${answered.length} AI answers shown, and all passed every check, so every figure in them came from the calculator`,
    });
  }

  const blockedDrafts = turns.flatMap(attempts).filter(blocked).length;
  const standard = turns.filter((t) => t.outcome === "standard_explanation").length;
  if (blockedDrafts > 0) {
    const tickets = trail.escalations.map((e) => String(e.ticketRef ?? "ticket failed"));
    const ticketText = tickets.length ? `ticket ${tickets.join(", ")}` : "no ticket";
    out.push({
      status: "warn",
      text: standard === 0
        ? `${count(blockedDrafts, "draft")} blocked and rewritten; no question needed the standard explanation`
        : `${count(blockedDrafts, "draft")} blocked; ${count(standard, "question")} got the standard explanation instead (${ticketText})`,
    });
  } else if (answered.length > 0) out.push({ status: "ok", text: "No drafts blocked" });

  const redirected = turns.filter((t) => t.outcome === "redirected").length;
  if (redirected > 0) {
    out.push({ status: "ok", text: `${count(redirected, "question")} answered with compliance wording, not the model's` });
  }

  const unanswered = turns.filter((t) => t.outcome === "unavailable" || t.outcome === "rate_limited").length;
  if (unanswered > 0) {
    out.push({
      status: "warn",
      text: `${count(unanswered, "question")} not answered (assistant unavailable or limit reached); the offer cards were unaffected`,
    });
  }
  return out;
}

export function timeline(trail: AuditTrail): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const session = trail.session;
  if (session) {
    events.push({ at: String(session.startedAt), title: "Quote started", details: [`Catalog ${String(session.catalogVersion)}`], record: session });
  }
  for (const c of trail.consents) {
    events.push({
      at: String(c.givenAt),
      title: `Consent given by ${String(c.homeownerName ?? "the homeowner (name not recorded)")}`,
      details: [`Consent wording version ${String(c.consentTextVersion)}`],
      record: c,
    });
  }
  for (const s of trail.offerSets) {
    const offers = Number(s.offerCount);
    const budget = s.budget == null ? "no budget given" : `budget ${money(Number(s.budget))}/mo`;
    events.push({
      at: String(s.requestedAt),
      title: offers === 0 ? "Soft check: no offers" : `Soft check: ${count(offers, "offer")}`,
      details: [`Amount ${money(Number(s.amount))}, ${budget}`, `Calculator ${String(s.quoteVersion)} · test profile ${String(s.applicantRef)}`],
      record: s,
    });
  }
  for (const t of turnsOf(trail)) events.push(turnEvent(t, trail));
  // Stable: a consent and its soft check can share a timestamp, and keep their recorded order.
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => a.event.at.localeCompare(b.event.at) || a.i - b.i)
    .map(({ event }) => event);
}

function turnEvent(t: Turn, trail: AuditTrail): TimelineEvent {
  const tickets = trail.escalations.filter((e) => e.turnId === t.id).map((e) => String(e.ticketRef ?? "ticket failed"));
  const drafts = attempts(t).map((a, i) => ({
    label: `Draft ${i + 1} ${blocked(a) ? "blocked" : "passed"}`,
    blocked: blocked(a),
    checks: draftChecks(a),
  }));
  const outcomes: Record<string, string> = {
    answered: "AI answer shown",
    standard_explanation: `Standard explanation shown · ${tickets.length ? `ticket ${tickets.join(", ")}` : "no ticket"}`,
    redirected: "Compliance wording shown; the explaining model wasn't used",
    suggested: `Inputs suggested: ${describe(t.suggestedInputs)}. Nothing changed until the contractor tapped Apply`,
    unavailable: "Assistant unavailable; the offer cards were unaffected",
    rate_limited: "Refused: question limit reached",
  };
  return {
    at: t.createdAt,
    title: `Q: ${t.message}`,
    details: turnDetails(t),
    ...(t.renderedAnswer && { shown: t.renderedAnswer }),
    ...(t.renderedSay && { said: t.renderedSay }),
    ...(drafts.length > 0 && { drafts }),
    outcome: outcomes[t.outcome] ?? t.outcome,
    record: t,
  };
}

/** What the turn was about and what produced it: offers on screen, models, prompt and rules versions, cost and time. */
function turnDetails(t: Turn): string[] {
  const offers = t.offersOnScreen?.length ? `Offers on screen: ${t.offersOnScreen.join(", ")}` : "No offers on screen";
  if (!t.models) return [offers];
  const models = Object.entries(t.models).map(([step, model]) => `${step} ${model}`).join(", ");
  const prompts = Object.values(t.promptVersions ?? {}).join(", ");
  const seconds = (t.latencyMs / 1000).toFixed(1);
  return [offers, `Models: ${models} · prompts ${prompts} · rules ${t.rulesVersion ?? "none"}`, `${t.inputTokens + t.outputTokens} tokens · ${seconds} s`];
}

function draftChecks(a: Attempt): DraftCheck[] {
  const why = (failed: Failure[]) => failed.map((f) => `"${f.quote}": ${f.reason}`).join("; ");
  const guardChecks = GUARD_RULES.map(([rule, name]): DraftCheck => {
    const failed = a.guard.failures.filter((f) => f.rule === rule);
    return failed.length === 0 ? { name, ok: true } : { name, ok: false, why: why(failed) };
  });
  const known = new Set<string>(GUARD_RULES.map(([rule]) => rule));
  for (const rule of new Set(a.guard.failures.map((f) => f.rule).filter((r) => !known.has(r)))) {
    guardChecks.push({ name: rule, ok: false, why: why(a.guard.failures.filter((f) => f.rule === rule)) });
  }
  const meaning: DraftCheck =
    a.verdict === null ? { name: "Meaning", ok: null }
    : a.verdict.pass ? { name: "Meaning", ok: true }
    : { name: "Meaning", ok: false, why: `"${a.verdict.quote ?? ""}": ${a.verdict.reason ?? ""}` };
  return [...guardChecks, meaning];
}

function describe(s: Turn["suggestedInputs"]): string {
  const parts = [
    s?.amount !== undefined && `amount ${money(s.amount)}`,
    s?.budget !== undefined && `budget ${money(s.budget)}/mo`,
    s?.projectType && `project ${s.projectType}`,
  ];
  return parts.filter(Boolean).join(", ") || "nothing";
}
