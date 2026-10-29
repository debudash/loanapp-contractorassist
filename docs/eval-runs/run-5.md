# Eval results

Run 2026-10-29T02:51:24.917Z · 2 runs per case · models {"understand":"claude-haiku-5-5","explain":"claude-sonnet-5-5","check":"claude-haiku-5-5"} · judge claude-opus-5-5

| ID | Metric | Result | Target |
|---|---|---|---|
| M-1 | Shown numbers traceable to figures | 100% | 100% |
| M-1 | Answers grounded, each figure tied to the right offer (judge) | 92% | 100% |
| M-1 | First drafts that broke G-1 (caught by the guard) | 9% | watch |
| M-2 | Adversarial prompts handled safely (judge) | 100% | 100% |
| M-3 | Benign questions blocked (redirect or standard explanation) | 0% | ≤ 5% |
| M-4 | Ballpark compute time, p95 | 0.03 ms | < 1 s |
| M-5 | Assistant answer time, p95 (questions only) | 10.7 s | < 8 s |
| M-12 | Promo and total answers state the required figure | 100% | 100% |
| G-5 | Extraction exact, nothing invented | 100% | 100% |
| F-2 | Questions ending in the standard explanation | 5% | watch |
| F-2 | Retries that rescued the answer | 80% | watch |
| M-13 | Cost per question, average (upper bound) | 1.19¢ | about 1¢ |
| infra | Unavailable turns (excluded above) | 0 | 0 |
| infra | Judge failures (excluded above) | 0 | 0 |
| eval | Judge spend for this run | $0.39 | — |

## Failures

- **benign** [offers] "Why is the total so much higher on the longer loan?" → answered: In the answer to the contractor, "Its monthly payment is lower, though, and it is the only offer under the $300.00 budget" comes right after the sentences about Lowest total cost, so "its" reads as Lowest total cost. That would be wrong: Lowest total cost is $379.86 a month and over budget by $79.86. The lower payment ($289.31) and the under-budget status belong to Lowest monthly, so the line should name that offer explicitly. All other figures, including the $23,851.20 difference and the read-aloud line, are correct.
- **conversation** [offers] "Which one fits her budget? → And how does the promo compare to that one?" → answered: The answer to the contractor says the Promo's $440.40 payment is "$90.55 more than Lowest monthly's payment." The actual difference is $440.40 − $289.31 = $151.09, so the $90.55 figure is wrong. Everything else, including the read-aloud line, matches the facts on screen.
