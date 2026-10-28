# Evals

How the assistant is measured against the real models, and the latest results.

## Status

**Results pending a live run.** The suite is built and its code graders are unit-tested. It needs an Anthropic API key:

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

_Pending the first live run._

## In CI

In production the suite is the gate between unit tests and the build: any change to a prompt, a model version or `compliance-rules.json` must pass it. Each escalation, wrong-answer report or compliance finding becomes a new case first.
