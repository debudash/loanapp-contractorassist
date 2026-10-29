// Summarises results/latest.json into results/summary.md. Promptfoo counts a grader that
// couldn't grade (for example, it refused scrambled text) and an error from our service (such
// as the 500-character limit) as fails; this keeps both apart from real policy breaks, and
// shows how the assistant handled each attack.
import { readFileSync, writeFileSync } from "node:fs";

const UNAVAILABLE = "The assistant is unavailable right now";
const data = JSON.parse(readFileSync("results/latest.json", "utf8"));
const results = Array.isArray(data.results) ? data.results : data.results.results;

const verdicts = new Map(); // strategy -> count per verdict
const handled = new Map(); // strategy -> { answered, redirected, ... }
const breaks = [];
const bump = (map, key, field) => {
  const row = map.get(key) ?? {};
  row[field] = (row[field] ?? 0) + 1;
  map.set(key, row);
};

for (const r of results) {
  const strategy = r.testCase?.metadata?.strategyId || "basic";
  const output = r.response?.output ?? "";
  const reason = r.gradingResult?.reason ?? "";
  // Promptfoo's failureReason 2 is an error from the target: our service answered with an error status.
  const targetError = r.response?.error ?? (r.failureReason === 2 ? r.error ?? "error" : null);
  // The grader returned nothing ("No output") or nothing it could read; the target's own errors are counted above.
  const notGraded = !r.success && !targetError && (/Could not extract JSON/.test(reason) || reason.trim() === "No output");
  const verdict = r.success ? "passed" : targetError ? "service error" : notGraded ? "not graded" : "broke a policy";
  bump(verdicts, strategy, verdict);
  const how = targetError ? `refused by the service: ${String(targetError).match(/"error":"(\w+)"/)?.[1] ?? "error"}`
    : output.includes(UNAVAILABLE) ? "unavailable (model call failed)"
    : (r.response?.metadata?.outcome ?? r.response?.metadata?.kind ?? "unknown");
  bump(handled, strategy, how);
  if (verdict === "broke a policy") {
    breaks.push(`- [${strategy}] ${r.testCase?.metadata?.pluginConfig?.policy?.trim().slice(0, 80) ?? ""}…\n  - Attack: ${String(r.vars?.prompt ?? "").slice(0, 200)}\n  - Answer: ${output.slice(0, 300)}\n  - Grader: ${reason.slice(0, 300)}`);
  }
}

const table = (title, map, columns) => [
  `## ${title}`, "",
  `| Strategy | ${columns.join(" | ")} |`,
  `|---|${columns.map(() => "---").join("|")}|`,
  ...[...map].map(([strategy, row]) => `| ${strategy} | ${columns.map((c) => row[c] ?? 0).join(" | ")} |`),
  "",
];
const outcomes = [...new Set([...handled.values()].flatMap((row) => Object.keys(row)))].sort();
const md = [
  "# Red team summary", "",
  `${results.length} attacks. Generated and graded by ${data.config?.redteam?.provider?.id ?? "the configured provider"}.`, "",
  ...table("Verdicts", verdicts, ["passed", "service error", "not graded", "broke a policy"]),
  ...table("How the assistant handled them", handled, outcomes),
  "## Policy breaks", "",
  breaks.length ? breaks.join("\n") : "None.",
  "",
].join("\n");
writeFileSync("results/summary.md", md);
console.log(md);
