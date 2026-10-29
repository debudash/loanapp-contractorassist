# Roadmap

Phase 0 is the prototype being submitted. Phase 1 is the pilot: the prototype connected to the company's real services. Phase 2 is everything else, including production hardening. This is the one list; the PRD, design doc and blueprint point here.

## Phase 0: prototype (this submission)

Budget-first ballpark, consent-gated soft check, three offer cards with every disclosure, the assistant (placeholders, guard, meaning check, fixed wording owned by compliance), the append-only audit trail with a compliance page (checklist and timeline for one quote), and the eval suite. See [README.md](../README.md).

## Phase 1: pilot (about two weeks)

Only what a pilot needs to run on real services with real contractors.

| Item | Why it can't wait |
|---|---|
| Replace the mocks with adapters to the real loan catalog, contractor profile and credit decision engine (`server/src/ports.ts`) | A pilot can't quote from mock data |
| Compliance review and sign-off of `compliance-rules.json`: phrase lists, fixed wording, consent and disclosure wording, and whether a soft-check decline triggers the lender's notice the no-offers wording promises (PRD NG-2) | Every borrower-facing word needs compliance approval |
| Embed the panel in the partner portal; the portal's gateway sets `x-contractor-id` from the signed-in session | Identity must come from authentication, not the browser (PRD A-4) |
| The soft check takes the homeowner's details from the portal's application (address, date of birth) instead of the credit mock profile | The real decision engine needs the applicant's identity |
| Deploy the service on ECS Fargate with the key in AWS Secrets Manager | The pilot runs in the company's environment |
| Audit store on RDS Postgres, the service's role limited to `INSERT` and `SELECT` | Append-only by permission, not by the prototype's triggers |
| Pilot with 20–30 roofing contractors behind a feature flag: cards first, then the assistant once eval and escalation rates hold | Contain risk while measuring real use |
| Contractor onboarding: one-page talk track, short walkthrough, a champion per region | Adoption is the pilot's main metric |

## Phase 2: everything else

### Product scope

| Item | Source |
|---|---|
| All trades, not just roofing | DESIGN §5 |
| Homeowner summary to finish the decision at home | DESIGN §5 |
| Feedback button on each answer, feeding new eval cases | DESIGN §5 |
| Document extraction for pay stubs, contractor estimates and scope letters | PRD NG-6, DESIGN §1 |
| RAG over policy documents and product terms, with a retrieval test set | PRD D-1 |
| Plaid income verification in the flow | PRD NG-6 |
| Submitting the application from the panel | PRD NG-6 |
| Voice input | PRD NG-6 |
| Fee transparency guard: cash price against amount financed | PRD A-1 |
| Compliance search across quotes (by contractor, homeowner, date) and a review queue for escalations | PRD FR-15 |

### Operations and data

| Item | Source |
|---|---|
| Funnel events to Snowflake and business-impact dashboards (M-6 to M-11) | DESIGN §6 |
| Zapier → Jira Service Management escalations live (stubbed today) | `escalation.ts`, DESIGN §2 |
| Weekly re-grading of sampled real turns by the eval judges, with alerts | DESIGN §6 |
| Eval suite as the CI gate: lint → unit tests → evals → build → staging → canary → monitor | DESIGN §6 |
| Nightly audit export to S3 with Object Lock | data-model.md |
| Audit writes through SQS so a slow database never slows an answer | architecture.md |

### Production hardening

| Item | Source |
|---|---|
| Meet the answer-time target reliably: p95 swings around 8 s (7.5 s in eval run 9, 9.5 s in run 10); cut second drafts and try a faster explain model | EVALS.md, PRD M-5 |
| Server-side model fallback on refusals | AI_LOG #29 |
| Rate limit in Redis instead of counting audit rows | AI_LOG #33, data-model.md |
| Generated API types shared by server and web, replacing the hand-mirrored types and card titles | AI_LOG #45, MR 5 |
| A typed contract for the audit trail API | AI_LOG #20 |
| Measure ballpark render time in the browser, not just compute time | EVALS.md (M-4) |
| More eval repeats per case, and keeping every run's raw results | EVALS.md |
| Runtime grounding check: Amazon Bedrock Guardrails' contextual grounding check on every answer before it's shown, through the `ApplyGuardrail` API (it works on any model's output). Grounding source: the offers, figures and official terms on screen; query: the contractor's question. Use the Standard tier (it handles conversational answers; it needs cross-Region inference), where AWS suggests 0.7 thresholds as a starting point. Start in detect-only mode (`action: NONE`), compare its scores with the eval judge's grounding verdicts, then switch to blocking, which falls back to the standard explanation. Its limits (1,000-character query, 5,000-character answer) fit ours | DESIGN §3, EVALS.md |
| Multi-step red-teaming in CI: Promptfoo's `jailbreak:tree`, `crescendo` and `hydra` strategies, which run on our own provider (the default `jailbreak` needs Promptfoo's cloud); record why a model call failed, so "unavailable" turns can be told apart | `redteam/`, EVALS.md |
