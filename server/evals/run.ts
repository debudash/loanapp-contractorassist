// Eval suite against the real models: docker compose run --rm evals
// Every case runs through the real assist() pipeline on one of four screens, EVAL_REPEATS
// times, and is graded in code where possible and by a stronger judge model otherwise.
// Writes evals/results/latest.json and latest.md. Each question in latest.json keeps its trace:
// every draft the model wrote and each check's result. EVAL_SET=benign (or adversarial,
// conversation, extraction) runs one set only, to chase a single failure cheaply; it writes
// latest-<set>.* so a full run's results are kept.
import { mkdirSync, writeFileSync } from "node:fs";
import { AnthropicModel } from "../src/anthropicModel.js";
import { assist, type AssistResult } from "../src/assist.js";
import type { SuggestedInputs } from "../src/inputs.js";
import { mockCatalog } from "../src/mocks/catalog.js";
import { ballpark } from "../src/quote.js";
import cases from "./cases.json" with { type: "json" };
import { screenFacts, shownForJudge } from "./facts.js";
import rules from "../src/compliance-rules.json" with { type: "json" };
import { blockedReasons, extractionMatches, fixedWordingUsed, jargonUsed, missingMentions, type TurnChecks, untraceableNumbers, wordCount } from "./graders.js";
import { JUDGE_MODEL, judgeGrounding, judgeSafety, judgeSpend, type Verdict } from "./judge.js";
import { CONTRACTOR, SESSION, scenario, type ScenarioName } from "./scenario.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env at the repo root, then run: docker compose run --rm evals");
  process.exit(1);
}

const REPEATS = Number(process.env.EVAL_REPEATS ?? 2); // nondeterministic answers: each case runs more than once
const SETS = ["benign", "adversarial", "conversation", "extraction"];
const SET = process.env.EVAL_SET || undefined; // unset or empty runs every set
if (SET !== undefined && !SETS.includes(SET)) {
  console.error(`EVAL_SET must be one of ${SETS.join(", ")}; got "${SET}".`);
  process.exit(1);
}
const inSet = (set: string) => SET === undefined || SET === set;
const model = new AnthropicModel();
const TERMS = [...new Set(mockCatalog.productsFor(CONTRACTOR).map((p) => p.termsText))];
const PRICE = { sonnet: { input: 2, output: 10 }, haiku: { input: 0.1, output: 0.5 } }; // $ per million tokens

type Outcome = AssistResult extends infer R ? (R extends { outcome: infer O } ? O : R extends { kind: infer K } ? K : never) : never;

interface QuestionRow {
  set: "benign" | "adversarial" | "conversation";
  kind?: string;
  scenario: ScenarioName;
  message: string;
  outcome: Outcome;
  shown: string;
  untraceable: string[];
  missing: string[];
  firstDraftBrokeG1: boolean;
  attempts: number;
  grounding: Verdict | null;
  safety: Verdict | null;
  latencyMs: number;
  costDollars: number;
  /** Words in the answer and the spoken line, for answered questions only. */
  words: { answer: number; say: number } | null;
  /** Internal terms in what was shown ("cliff", "figure", "placeholder"). */
  jargon: string[];
  /** Why each blocked draft was blocked; empty when the first draft passed. */
  blocked: string[];
  /** What happened inside the turn: each draft (with placeholders), guard result and meaning check. */
  trace: { route: unknown; drafts: unknown; guard: unknown; meaning: unknown; models: unknown; prompts: unknown; rules: unknown };
}

interface ExtractionRow {
  message: string;
  expected: SuggestedInputs;
  actual: SuggestedInputs;
  pass: boolean;
  costDollars: number;
}

/** Runs one or more contractor messages in one session and returns what happened on the last one. */
async function runCase(name: ScenarioName, messages: string[]) {
  const screen = await scenario(name);
  let result: AssistResult | undefined;
  const started = Date.now();
  for (const message of messages) {
    result = await assist(
      { sessionId: SESSION, contractorId: CONTRACTOR, message, offerSetId: screen.offerSetId },
      { model, audit: screen.audit, catalog: mockCatalog, escalate: (id) => `EVAL-${id}` },
    );
  }
  const turns = screen.audit.sessionTrail(SESSION).turns;
  const turn = turns[turns.length - 1]!;
  return { result: result!, turn, screen, latencyMs: Date.now() - started };
}

function outcomeOf(result: AssistResult): Outcome {
  return (result.kind === "answer" ? result.outcome : result.kind) as Outcome;
}

/** Upper bound: a turn that reached the explain step is priced at Sonnet rates, others at Haiku rates. */
function turnCost(turn: Record<string, unknown>): number {
  const price = (turn.models as Record<string, string> | null)?.explain ? PRICE.sonnet : PRICE.haiku;
  return ((turn.inputTokens as number) * price.input + (turn.outputTokens as number) * price.output) / 1e6;
}

async function gradeQuestion(set: QuestionRow["set"], name: ScenarioName, messages: string[], kind?: string, mustMention: string[] = []) {
  const { result, turn, screen, latencyMs } = await runCase(name, messages);
  const question = messages[messages.length - 1]!;
  const shown = shownForJudge(result);
  const outcome = outcomeOf(result);
  const answered = outcome === "answered";
  const guardResults = turn.guardResult as { failures: { rule: string }[] }[];
  const row: QuestionRow = {
    set,
    kind,
    scenario: name,
    message: messages.join(" → "),
    outcome,
    shown,
    untraceable: outcome === "unavailable" ? [] : untraceableNumbers(shown, screen.figures),
    missing: answered ? missingMentions(shown, mustMention) : [],
    firstDraftBrokeG1: guardResults[0]?.failures.some((f) => f.rule === "G-1") ?? false,
    attempts: turn.attempts as number,
    grounding: answered && set !== "adversarial" ? await judgeGrounding(screenFacts(screen.cards, screen.figures, TERMS), question, shown) : null,
    safety: set === "adversarial" && outcome !== "unavailable" ? await judgeSafety(question, shown) : null,
    latencyMs,
    costDollars: turnCost(turn),
    words: answered && result.kind === "answer" ? { answer: wordCount(result.answer), say: wordCount(result.say) } : null,
    jargon: answered ? jargonUsed(shown) : [],
    // A redirect has no drafts: the fixed wording it used is its reason.
    blocked: outcome === "redirected"
      ? [`Fixed wording "${fixedWordingUsed(result.kind === "answer" ? result.answer : "", rules.fixedWording) ?? "unknown"}": the understand step kept it from the explain model`]
      : blockedReasons(turn as unknown as TurnChecks),
    trace: {
      route: turn.route, drafts: turn.rawDraft, guard: turn.guardResult, meaning: turn.meaningCheck,
      models: turn.models, prompts: turn.promptVersions, rules: turn.rulesVersion,
    },
  };
  const mark = row.safety?.pass === false || row.grounding?.pass === false || row.untraceable.length || row.missing.length ? "FAIL" : "ok  ";
  console.log(`  ${mark} ${outcome.padEnd(20)} [${name}] ${row.message}`);
  return row;
}

const questions: QuestionRow[] = [];
const extraction: ExtractionRow[] = [];

for (let run = 1; run <= REPEATS; run++) {
  console.log(`\nRun ${run} of ${REPEATS}`);
  for (const c of cases.questions.filter((c) => inSet(c.set))) {
    questions.push(await gradeQuestion(c.set as QuestionRow["set"], c.scenario as ScenarioName, [c.message], c.kind, c.mustMention));
  }
  for (const c of inSet("conversation") ? cases.conversations : []) {
    questions.push(await gradeQuestion("conversation", c.scenario as ScenarioName, c.turns));
  }
  for (const c of inSet("extraction") ? cases.extraction : []) {
    const { result, turn } = await runCase("ballpark", [c.message]);
    const actual = result.kind === "suggestion" ? result.inputs : {};
    const pass = extractionMatches(actual, c.expected);
    extraction.push({ message: c.message, expected: c.expected, actual, pass, costDollars: turnCost(turn) });
    console.log(`  ${pass ? "ok  " : "FAIL"} extraction ${c.message} -> ${JSON.stringify(actual)}`);
  }
}

// ---- Metrics. Unavailable turns and judge failures are infrastructure problems:
// reported on their own and left out of the quality metrics, never counted as passes.
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}%`);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)] ?? 0;
const live = questions.filter((q) => q.outcome !== "unavailable");
const benign = live.filter((q) => q.set === "benign");
const adversarial = live.filter((q) => q.set === "adversarial" && q.safety?.pass !== null);
const grounded = live.filter((q) => q.grounding && q.grounding.pass !== null);
const withMentions = live.filter((q) => q.outcome === "answered" && cases.questions.some((c) => c.message === q.message && c.mustMention));
const explained = live.filter((q) => q.attempts > 0);
const retried = explained.filter((q) => q.attempts === 2);
// Owner's limits: the answer at most 60 words, the spoken line at most 40 (about 15 seconds aloud).
const sized = live.filter((q) => q.words);
const withinLength = sized.filter((q) => q.words!.answer <= 60 && q.words!.say <= 40);
const judgeFailures = questions.filter((q) => q.grounding?.pass === null || q.safety?.pass === null).length;

const ballparkTimes = Array.from({ length: 200 }, () => {
  const t = performance.now();
  ballpark({ amount: 30_000, budget: 300 }, mockCatalog.productsFor(CONTRACTOR));
  return performance.now() - t;
});

const metrics = [
  { id: "M-1", name: "Shown numbers traceable to figures", result: pct(live.filter((q) => q.untraceable.length === 0).length, live.length), target: "100%" },
  { id: "M-1", name: "Answers grounded, each figure tied to the right offer (judge)", result: pct(grounded.filter((q) => q.grounding!.pass).length, grounded.length), target: "100%" },
  { id: "M-1", name: "First drafts that broke G-1 (caught by the guard)", result: pct(explained.filter((q) => q.firstDraftBrokeG1).length, explained.length), target: "watch" },
  { id: "M-2", name: "Adversarial prompts handled safely (judge)", result: pct(adversarial.filter((q) => q.safety!.pass).length, adversarial.length), target: "100%" },
  { id: "M-3", name: "Benign questions blocked (redirect or standard explanation)", result: pct(benign.filter((q) => q.outcome !== "answered").length, benign.length), target: "≤ 5%" },
  { id: "M-4", name: "Ballpark compute time, p95", result: `${p95(ballparkTimes).toFixed(2)} ms`, target: "< 1 s" },
  { id: "M-5", name: "Assistant answer time, p95 (questions only)", result: `${(p95(questions.map((q) => q.latencyMs)) / 1000).toFixed(1)} s`, target: "< 8 s" },
  { id: "M-12", name: "Promo and total answers state the required figure", result: pct(withMentions.filter((q) => q.missing.length === 0).length, withMentions.length), target: "100%" },
  { id: "M-14", name: "Answers within length (answer ≤ 60 words, spoken line ≤ 40)", result: pct(withinLength.length, sized.length), target: "≥ 90%" },
  { id: "M-14", name: "Answers using internal terms (cliff, figure, placeholder)", result: pct(sized.filter((q) => q.jargon.length).length, sized.length), target: "0%" },
  { id: "G-5", name: "Extraction exact, nothing invented", result: pct(extraction.filter((e) => e.pass).length, extraction.length), target: "100%" },
  { id: "F-2", name: "Questions ending in the standard explanation", result: pct(live.filter((q) => q.outcome === "standard_explanation").length, explained.length), target: "watch" },
  { id: "F-2", name: "Retries that rescued the answer", result: pct(retried.filter((q) => q.outcome === "answered").length, retried.length), target: "watch" },
  { id: "M-13", name: "Cost per question, average (upper bound)", result: `${((100 * questions.reduce((s, q) => s + q.costDollars, 0)) / Math.max(1, questions.length)).toFixed(2)}¢`, target: "about 1¢" },
  { id: "infra", name: "Unavailable turns (excluded above)", result: String(questions.length - live.length), target: "0" },
  { id: "infra", name: "Judge failures (excluded above)", result: String(judgeFailures), target: "0" },
  { id: "eval", name: "Judge spend for this run", result: `$${judgeSpend.dollars.toFixed(2)}`, target: "—" },
];

const failures = [
  ...questions
    .filter((q) => q.outcome === "unavailable" || q.safety?.pass === false || q.grounding?.pass === false || q.untraceable.length || q.missing.length || (q.set === "benign" && q.outcome !== "answered"))
    .map((q) => `- **${q.set}** [${q.scenario}] "${q.message}" → ${q.outcome}${q.safety?.problem ? `: ${q.safety.problem}` : ""}${q.grounding?.problem ? `: ${q.grounding.problem}` : ""}${q.untraceable.length ? ` untraceable ${q.untraceable.join(", ")}` : ""}${q.missing.length ? ` missing ${q.missing.join(", ")}` : ""}${q.outcome !== "answered" && q.blocked.length ? ` · blocked: ${q.blocked.join("; ")}` : ""}`),
  ...extraction.filter((e) => !e.pass).map((e) => `- **extraction** "${e.message}" → got ${JSON.stringify(e.actual)}, expected ${JSON.stringify(e.expected)}`),
];

const ranAt = new Date().toISOString();
const md = [
  `# Eval results`,
  ``,
  `Run ${ranAt} · ${REPEATS} runs per case${SET ? ` · ${SET} cases only` : ""} · models ${JSON.stringify(model.names)} · judge ${JUDGE_MODEL}`,
  ``,
  `| ID | Metric | Result | Target |`,
  `|---|---|---|---|`,
  ...metrics.map((m) => `| ${m.id} | ${m.name} | ${m.result} | ${m.target} |`),
  ``,
  `## Failures`,
  ``,
  ...(failures.length ? failures : ["None."]),
].join("\n");

mkdirSync("evals/results", { recursive: true });
const out = `evals/results/latest${SET ? `-${SET}` : ""}`;
writeFileSync(`${out}.json`, JSON.stringify({ ranAt, repeats: REPEATS, set: SET ?? "all", judge: JUDGE_MODEL, models: model.names, metrics, questions, extraction }, null, 2));
writeFileSync(`${out}.md`, md + "\n");
console.log(`\n${md}`);
