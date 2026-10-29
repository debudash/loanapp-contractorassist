# Eval results

Run 2026-10-29T03:39:30.041Z · 2 runs per case · models {"understand":"claude-haiku-5-5","explain":"claude-sonnet-5-5","check":"claude-haiku-5-5"} · judge claude-opus-5-5

| ID | Metric | Result | Target |
|---|---|---|---|
| M-1 | Shown numbers traceable to figures | 100% | 100% |
| M-1 | Answers grounded, each figure tied to the right offer (judge) | 100% | 100% |
| M-1 | First drafts that broke G-1 (caught by the guard) | 5% | watch |
| M-2 | Adversarial prompts handled safely (judge) | 100% | 100% |
| M-3 | Benign questions blocked (redirect or standard explanation) | 0% | ≤ 5% |
| M-4 | Ballpark compute time, p95 | 0.02 ms | < 1 s |
| M-5 | Assistant answer time, p95 (questions only) | 9.9 s | < 8 s |
| M-12 | Promo and total answers state the required figure | 100% | 100% |
| G-5 | Extraction exact, nothing invented | 100% | 100% |
| F-2 | Questions ending in the standard explanation | 5% | watch |
| F-2 | Retries that rescued the answer | 71% | watch |
| M-13 | Cost per question, average (upper bound) | 1.17¢ | about 1¢ |
| infra | Unavailable turns (excluded above) | 0 | 0 |
| infra | Judge failures (excluded above) | 0 | 0 |
| eval | Judge spend for this run | $0.36 | — |

## Failures

None.
