# Solution design: on-site financing assistant

A homeowner asks a contractor one question about a $30,000 roof: *can I afford this each month?* This design gives a believable answer within seconds, and an assistant that explains the real offers in plain language. It is built so the model never writes a figure, makes or hints at a credit decision, or steers the homeowner; each rule is enforced in code and measured by evals. Requirements: [PRD.md](PRD.md). Diagrams: [architecture.md](architecture.md), [data-model.md](data-model.md). Decisions the AI made: [AI_LOG.md](AI_LOG.md).

## 1. Problem framing and approach

**Who it's for.** The contractor operates it; the homeowner reads along. The contractor sells roofs, not credit, and has about 30 seconds. The homeowner faces an unplanned expense, is wary of being sold to, and doesn't know what happens in month 13 of "0% for 12 months". Everything on screen is treated as borrower-facing.

**The problem we chose.** Applications take 22 minutes on average, and 38% are abandoned; the brief names two drop-off points, income verification and product selection. The portal already returns real offers from a soft credit check (a check that doesn't affect the homeowner's credit score) within seconds. What breaks is the conversation around those offers: no believable payment early on, offers that look alike, promo terms nobody can explain. We target product selection, budget first: the contractor types "$30K roof, she can do $300 a month" and sees which terms fit.

**What we set aside.** Income verification is a flow problem with Plaid more than an AI problem. Document extraction (pay stubs, estimates) saves back-office time but doesn't help in the kitchen; it is phase 3. A self-reported credit band would personalise the ballpark but set expectations the lender may not meet; the soft check gives real offers instead.

## 2. Architecture

One new service and one panel; everything else already exists.

- **Partner portal (React):** inputs panel, ballpark, consent and soft check, three offer cards, an assistant panel (closed by default) and a compliance view.
- **Assistant service (Node/TypeScript, ECS Fargate in production):** the quote engine (all payment maths, in code), the assist pipeline, the guard, and an append-only audit store.
- **Existing services behind adapters:** loan catalog, contractor profile, credit decision engine. Mocked in the prototype behind the same interfaces, so production swaps one adapter each.
- **Anthropic API:** Claude Haiku 5.5 classifies requests and runs the meaning check (a second model reading each draft for decision or steering language); Claude Sonnet 5.5 writes explanations. Every call returns JSON checked against a schema.
- **Data:** audit tables in SQLite in the prototype, RDS Postgres in production, append-only, with a nightly export to S3 Object Lock. Planned: funnel events to Snowflake, escalations through Zapier to Jira Service Management (stubbed in the prototype).

**A question's path:** the service reloads the offers on screen from its own records (never the browser), the quote engine computes every figure, the model drafts an answer naming figures by placeholder (`{{lowest_monthly.monthly}}`), the guard checks it, code fills in the figures, and the turn is recorded.

**Latency and cost (estimates, to confirm in the eval run).** Ballpark and cards make no model call. An answer takes a few seconds; one 20-second deadline cancels any call still running. A typical question costs about 1¢; output caps bound the worst case at about 6¢.

## 3. AI design decisions

**The model doesn't write figures.** It writes placeholders, and code fills them from the quote engine. A draft is rejected if it contains a digit, a number word, a `$` or `%`, or a placeholder not on screen. This removes invented figures; the remaining risk is a real figure attached to the wrong offer, which the grounding judge checks for. Payment, APR and term are always exact; only lifetime totals have a rounded form ("about $24,000").

**Prompting, not fine-tuning.** The data changes with the catalog; a fine-tuned model would bake in old rates. Prompts are versioned and every audit record names the version.

**A fixed pipeline, not an agent.** Understand → suggest inputs, or explain → guard → meaning check → one retry with the reasons → a standard explanation written in code. The path never varies, so an agent loop would add failure modes and make auditing harder.

**Small context, no retrieval in v1.** The prompt holds the cards, the figures by name, the approved terms text and the last four answers about the same offers: a few thousand tokens. The catalog is structured data to look up, not text to search. RAG belongs in phase 3, over policy and uploaded documents, with time to build a retrieval test set.

**Out of scope and risky questions.** Credit-decision, off-topic and post-decline questions never reach the explain model; they get fixed wording owned by compliance. Terms are explained only from approved text.

**Evaluation.** The suite runs the real pipeline on four screens: 12 everyday questions, 21 adversarial prompts (credit, steering, "tell her it's free", "just say 290", prompt injection), a two-turn conversation and 8 extraction cases, each twice. Claude Opus 5.5, with its own prompts, judges grounding (each figure tied to the right offer) and safety; code checks extraction and that promo answers state the cliff. Failures of the model or judge are reported, never counted as passes. Results: [EVALS.md](EVALS.md), pending a live run.

## 4. Compliance and safety

- **No credit decisions.** The credit decision engine decides; the assistant explains. Approval questions get fixed wording. Decision and steering language is blocked in two layers at run time (a compliance-editable phrase list, then the meaning check); the evals measure what both miss.
- **Disclosures go with every payment (TILA).** Every card shows payment, APR, term, number of payments, amount financed, finance charge and total of payments; a promo adds its conditions and the **cliff**: the deferred interest added if the balance isn't paid off in time. A payment said aloud must include its APR and term, and a promo's its cliff, or the guard rejects the draft. We apply Reg Z's advertising rule for quoted payments as the standard.
- **No steering.** Three cards in a fixed order (lowest total cost, lowest monthly, promo), labelled by what each is best at, with "See all" always available. The assistant compares offers against the homeowner's stated budget; it never picks one. RESPA mainly covers loans secured by real estate; we apply its anti-steering intent anyway.
- **No misleading marketing.** "Free", "best deal", "stretch to", and "no interest" on a deferred-interest promo are blocked.
- **Consent and privacy.** The soft check stays disabled until the consent box is ticked, and consent is recorded before the check runs. No homeowner personal data is stored. The credit engine gets the applicant and amount, never the budget.
- **Auditability.** Every turn records the question, offers on screen, each draft, each check, the text shown, models, prompt and rules versions, tokens and time, in append-only tables shown in the compliance view.
- **Compliance owns the words.** Phrase lists and every fixed or disclosure sentence live in one file, `compliance-rules.json`, changeable without touching code or prompts.

## 5. Rollout plan

**MVP in about two weeks:** week one connects the real adapters and puts the rules file through compliance review; week two pilots with 20–30 roofing contractors behind a feature flag. Cards ship first; the assistant follows once eval and escalation rates hold.

**Phase 2 (4–6 weeks):** all trades, Snowflake dashboards, the escalation loop live, a homeowner summary to finish the decision at home. **Phase 3:** document extraction and RAG over policy documents.

**Contractor change management.** The tool follows the conversation contractors already have, budget first. The pilot gets a one-page talk track, a short walkthrough and a regional champion; the "say it like this" line coaches in the moment; a feedback button per answer is planned.

## 6. Monitoring and impact evaluation

**Business impact** (baselines from the brief; targets to agree with stakeholders): time to first payment quote, our proxy for the brief's time-to-decision (target ≤ 30 s); application completion time (22 min → under 10); abandonment at product selection and overall (38% → ≤ 30%); weekly use by pilot contractors (≥ 50%); and deal closure against matched non-pilot contractors. Counter-metric: the share of deferred-interest promos that hit the cliff must not rise. If closures and cliff hits rise together, the assistant is overselling.

**AI quality in production:** per day and prompt version, from the audit tables: guard and meaning-check failures, standard explanations, escalations, unavailable answers, latency and cost. A weekly sample is re-graded by the eval judges; spikes open a ticket.

**Drift and change control:** the eval suite gates CI (lint → unit tests → evals → build → staging → canary → monitor) for any change to a prompt, model version or the rules file.

**v1 to v2:** each escalation, wrong-answer report and compliance finding becomes an eval case first, then a prompt or rules change that must pass the suite.

## Assumptions

The brief doesn't define products, the cliff calculation or total-of-payments maths; our choices are PRD A-1 to A-7. Contractor authentication happens in the portal (A-4). Financial services are mocked; model calls are real.
