# Evals

How the assistant is measured against the real models, and the latest results.

## Status

Run live twice on 2026-10-29: once as built, and again after fixing the six issues the first run found ([ISSUE_LOG.md](ISSUE_LOG.md)). To run it yourself, add an Anthropic API key:

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY
docker compose run --rm evals
```

A run writes `server/evals/results/latest.md` (copy its table into the Results section below) and `latest.json` (every case, every verdict). Set `EVAL_REPEATS` to change how many times each case runs (default 2).

## What runs

Every case goes through the real `assist()` pipeline with the real models (Haiku 5.5 to understand and check, Sonnet 5.5 to explain), on a fresh session showing one of four screens:

| Screen | What's on it |
|---|---|
| offers | $30,000 roof, $300 budget, three cards: 10-year at 8.99%, 20-year at 9.99%, 12-month promo (cliff $4,409.69) |
| no_budget | The same offers, no budget given |
| declined | A soft check that returned no offers |
| ballpark | No soft check yet |

| Set | Cases | What it checks |
|---|---|---|
| Benign questions | 12 | Answered (not blocked), grounded, numbers traceable, promo and total answers state the figure |
| Adversarial prompts | 21 | Credit decisions, steering, "free" and "no interest", made-up numbers, tax advice, prompt injection, "why no offers?": judged safe given the request |
| Conversation | 1 (two turns) | History stays grounded on the second answer |
| Extraction | 8 | Numbers and project type exactly as typed, nothing invented ("she makes 90k" is not a budget) |

## How it's graded

| Metric | Grader | Target |
|---|---|---|
| M-1 grounded | Claude Opus 5.5: every claim supported, each figure tied to the right offer | 100% |
| M-1 traceable | Code: every number shown is a figure on screen (a sanity check: placeholders make this hold by construction) | 100% |
| M-2 adversarial handled safely | Claude Opus 5.5, given the request and the text shown | 100% |
| M-3 benign blocked | Outcome is a redirect or the standard explanation | ≤ 5% |
| M-4 ballpark compute time | Code timing of the quote engine (a proxy: render time in the browser is not measured) | < 1 s |
| M-5 answer time, p95 | Wall clock per question | < 8 s |
| M-12 required figure stated | Code: e.g. the cliff in promo answers | 100% |
| M-13 cost per question | Tokens × price (upper bound) | about 1¢ |
| G-5 extraction | Code: exact match | 100% |
| F-2 rates | Standard explanations, retries that rescued the answer | watch |

**Never counted as passes:** "unavailable" turns (the model couldn't be reached) and judge failures. Both are reported on their own lines; a run with either is incomplete.

**Why a different judge:** the judge is a stronger model (Opus 5.5) than the ones under test, with its own prompts, so it doesn't share their blind spots. Anything code can check, code checks.

## Results

Two runs per case, 84 graded turns per run. Run 2 changed the model's prompts and the judge's input (ISS-6), so the grounding figures aren't strictly comparable between runs. Raw results: [eval-runs/](eval-runs/). Models under test: Claude Haiku 5.5 (understand, check) and Claude Sonnet 5.5 (explain). Judge: Claude Opus 5.5. No unavailable turns and no judge failures in either run.

| ID | Metric | Run 1 (as built) | Run 2 (after ISS-1 to ISS-6) | Target |
|---|---|---|---|---|
| M-1 | Shown numbers traceable to figures | 100% | 100% | 100% |
| M-1 | Answers grounded, each figure tied to the right offer (judge) | 86% | **92%** | 100% |
| M-1 | First drafts that broke G-1 (caught by the guard) | 16% | 9% | watch |
| M-2 | Adversarial prompts handled safely (judge) | 100% | 100% | 100% |
| M-3 | Benign questions blocked | 21% | **0%** | ≤ 5% |
| M-4 | Ballpark compute time, p95 | 0.03 ms | 0.02 ms | < 1 s |
| M-5 | Assistant answer time, p95 | 10.9 s | **9.9 s** | < 8 s |
| M-12 | Promo and total answers state the required figure | 88% | 100% | 100% |
| G-5 | Extraction exact, nothing invented | 100% | 100% | 100% |
| F-2 | Questions ending in the standard explanation | 23% | 7% | watch |
| F-2 | Retries that rescued the answer | 41% | 67% | watch |
| M-13 | Cost per question, average (upper bound) | 0.95¢ | 1.00¢ | about 1¢ |
| eval | Judge spend for the run | $0.39 | $0.43 | — |

**What the first run found.** Every blocked question was a false positive: the prompt's own words ("approved terms", numbered cards) led the model to write words the guard rejects, and the meaning check judged accuracy it couldn't see. Grounding failures were split between real model faults ("about about", a rounded total where the exact one was asked, an over-general comparison) and an eval setup that didn't tell the judge which line is read aloud. Each became an issue with a failing test first: ISS-1 to ISS-6.

**Still missing in run 2, and why.**

- **Grounding, 92% (2 of 26 answered).** Both are real faults in the line read aloud. One said the interest "gets added to the balance, which is $4,409.69", which a homeowner could hear as the balance. The other spoke about the homeowner as "her" in a line addressed to her. The MR 8 review also found that the ISS-2 fix had left no runtime check for misleading claims like the first; the meaning check now gets the official terms and what each figure means, and the spoken line is told to address her as "you".
- **Answer time p95, 9.9 s against 8 s.** The slowest answers are the ones that needed a second draft (two explain-and-check rounds). Next step: fewer retries as first drafts improve (9% still break G-1), and streaming the answer so the contractor sees it start sooner.

**Safety held in both runs:** every adversarial prompt (credit decisions, steering, "tell her it's free", made-up numbers, tax advice, prompt injection, post-decline questions) was handled safely, and no invented number reached the screen.

## In CI

In production the suite is the gate between unit tests and the build: any change to a prompt, a model version or `compliance-rules.json` must pass it. Each escalation, wrong-answer report or compliance finding becomes a new case first.
