# AI log

How AI was used to build this submission, and every decision the AI made itself. Decisions the human locked during design review are in [PRD.md](PRD.md); this log records the calls the AI made, so each one can be checked and explained.

## How AI was used

- **Tool:** Claude Code (model: Claude Opus 5.5).
- **Design:** problem framing, PRD, blueprint and architecture were drafted by the AI, then challenged and decided by the human in a structured review ("grill"), one decision at a time.
- **Build:** test-first, in vertical slices. The AI writes the failing test, then the code. Tests run in Docker.
- **Review:** each slice is reviewed by two separate AI reviewers, one for coding standards and one against the PRD. Findings, decisions and fixes are recorded in the slice's merge request.
- **Human role:** owns every product and compliance decision, sets scope, and can stop or redirect at any point. The AI asks before decisions that are the human's to make.

## Decisions made by the AI

"Approved" means the AI proposed it and the human agreed. "AI" means the AI decided within the agreed scope; the human can reverse any of these.

| # | Date | Decision | Why | Where | Decided by |
|---|---|---|---|---|---|
| 1 | 2026-10-28 | Two models by job: Haiku 5.5 to read requests and run the meaning check, Sonnet 5.5 to write explanations | Reading a request needs speed and a strict schema; explaining needs judgment and tone | blueprint, architecture | Approved |
| 2 | 2026-10-28 | Mock catalog: fixed-rate terms of 5–25 years plus one 12-month deferred-interest promo; APR range 7.99%–17.99% | The brief gives the loan ranges but no products | PRD A-1 | AI |
| 3 | 2026-10-28 | Promo cliff = interest building on the falling principal during the promo, all added if not paid off. Corrected an earlier figure ($4,759.61) that wrongly compounded the interest; the right one is $4,409.69 | The brief doesn't define the calculation | PRD A-6, `amortize.ts` | AI |
| 4 | 2026-10-28 | Total of payments = rounded monthly payment × number of payments | It's what the borrower actually pays; ignores the final-payment adjustment | PRD A-7 | AI |
| 5 | 2026-10-28 | Fixed card order: lowest total cost, lowest monthly, promo | Order is itself a nudge; lowest total first avoids pushing the longest loan | PRD FR-6 | Approved |
| 6 | 2026-10-28 | One offer can be labelled "lowest total and monthly"; promos compete only for the promo slot; two filler cards get distinct labels | Labels must always be true, and every card needs its own placeholder names (found in review) | PRD FR-6, `quote.ts` | AI |
| 7 | 2026-10-28 | Rounded figures only for lifetime totals of $1,000 or more | Small amounts rounded to "about $0" (found in review) | PRD G-1, `quote.ts` | AI |
| 8 | 2026-10-28 | Ports 4100 (API) and 5180 (web) | Clear of the human's other running containers | architecture | AI |
| 9 | 2026-10-28 | The guard's phrase lists are deliberately conservative: "qualify", "free", "half" and "grand" stay blocked even when a sentence is honest; "one" and "suggest" are allowed | Blocking an honest sentence costs one retry; missing a bad one reaches the homeowner. "One" is mostly a pronoun; the assistant must be able to suggest questions to the contractor | `compliance-rules.json`, `guard.ts` | AI |
| 10 | 2026-10-28 | Known gaps left to the meaning check and evals, not the phrase list: "one year", "fiftyish", "I'd suggest", other rewordings | A phrase list can never be complete; adding words either misses variants or blocks honest sentences | PRD G-1 to G-3, MR 1 | AI |
| 11 | 2026-10-28 | Input check accepts the risk of "1,5" read as 15, "25-30k", and swapped amount and budget | The contractor sees every suggested number and taps Apply before anything runs | `inputs.ts`, MR 1 | AI |
| 12 | 2026-10-28 | Compliance rules file is a table of `{ rule, reason, phrases, whenPromoOnScreen }`, checked at load | Compliance can add a list without a code change, and a typo fails loudly | `compliance-rules.json`, `guard.ts` | AI |
| 13 | 2026-10-28 | Audit store moved from an append-only JSONL file to SQLite tables (Node's built-in `node:sqlite`), append-only enforced by triggers | The human asked to review tables; SQLite gives real tables with no native install and mirrors the production Postgres design | `schema.ts`, data-model.md | AI |
| 14 | 2026-10-28 | Mock decision engine fixtures: "strong", "moderate" (the worked example) and "no_offers"; mock contractors Summit Roofing (all products) and Valley HVAC (short fixed terms) | Covers every card path and the no-offers path with known numbers | `mocks/` | AI |
| 15 | 2026-10-28 | Session IDs come from the portal; a session belongs to the contractor who opened it, and another contractor gets 403 | Keeps one contractor from reading or writing another's audit trail | `app.ts` | AI |
| 16 | 2026-10-28 | Approved terms text for the promo avoids the phrase "no interest" ("interest builds up from the start but is not charged if…") | The guard blocks "no interest" when a promo is on screen, and the approved wording is more honest about how deferred interest works | `mocks/catalog.ts` | AI |
| 17 | 2026-10-28 | Session IDs are generated by the service (`POST /api/sessions`); reads never create sessions | A client-chosen ID could be claimed by another contractor first (found in review) | `app.ts` | AI |
| 18 | 2026-10-28 | If the soft check fails after consent, the consent row stays and the API answers 502 | Consent was given; the trail should show it, and that no offers were recorded | `app.ts`, data-model.md | AI |
| 19 | 2026-10-28 | Append-only enforced by SQLite triggers plus `recursive_triggers` on the service's connection. A different connection without that setting could still `INSERT OR REPLACE` | Prototype limit; production closes it with database role rights (no `UPDATE`/`DELETE`) | `schema.ts`, `audit.ts` | AI |
| 20 | 2026-10-28 | The audit trail API returns database rows with camelCase keys, without a typed contract | Prototype trade-off; a typed contract belongs with the production API | `audit.ts` | AI |
