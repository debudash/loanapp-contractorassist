# On-site financing assistant

A contractor in a homeowner's kitchen types *"$30K roof, she can do $300 a month"* and sees payment ranges straight away. After a soft credit check, three real offers appear with every disclosure. An assistant explains them in plain language.

The assistant is designed so the model never writes a figure, never makes or hints at a credit decision, and never steers the homeowner. Each rule is enforced in code and measured by evals. Every answer is recorded for compliance.

**Live demo: https://gl-loanappassist.fly.dev** (the assistant answers up to 300 questions a day across all visitors).

Built for the AI Solutions Engineer take-home. Design document: [docs/DESIGN.md](docs/DESIGN.md). Solution blueprint, the same design as a visual walkthrough: [docs/solution_blueprint.pdf](docs/solution_blueprint.pdf) (or [the HTML version](docs/solution_blueprint.html), to open in a browser).

## Thin on purpose

> "We're a small engineering team. I need solutions we can actually operate. Don't give me a science project." (CTO, in the brief)

One question, answered end to end, by one service a small team can run. A homeowner's loan question has one way to go badly wrong: a number, a promise or a hint of approval that isn't true. So the slice is narrow, from budget to offers, and the effort went into making that one path hard to get wrong and easy to prove.

**What you see:** four guided steps, three offer cards, one chat panel, one compliance page.

**Underneath:**

- Every figure computed in code; the model writes placeholders, and a guard rejects any number it writes itself.
- A second model reads each draft for decisions and steering; one retry, then a standard explanation written in code.
- Credit questions get compliance's wording, never the model's; every phrase list and fixed sentence lives in one file compliance owns.
- Every draft, check and answer is recorded, append-only.
- 42 eval cases, run twice, judged by a stronger model; 120 red-team attacks, and no answer broke a rule.
- Every bug found after merge is logged with a test written first ([docs/ISSUE_LOG.md](docs/ISSUE_LOG.md)).

**What it takes to run:** one new service, a few append-only tables, one API key. No vector store, no GPU, no training pipeline. About 1¢ a question.

**What we said no to, and why:**

| Tempting | Why not now |
|---|---|
| An agent loop | A fixed path is easier to run, test and audit; an agent adds ways to fail |
| RAG | The catalog is structured data to look up; retrieval needs its own test set first (Phase 2, over policy documents) |
| Fine-tuning | Rates change with the catalog; versioned prompts are logged with every answer instead |
| Document extraction | Saves back-office time but doesn't help in the kitchen (Phase 2) |
| Income verification | A flow problem with Plaid more than an AI problem |
| A self-reported credit band | Would set expectations the lender may not meet; the soft check gives real offers |
| A quotes list for the contractor | The portal already lists applications; the assistant panel opens from there |

## Run it

You need Docker. Nothing else runs on your machine. The first build downloads dependencies and takes a few minutes; after that the stack starts in seconds.

```bash
cp .env.example .env          # optional: add ANTHROPIC_API_KEY to enable the assistant
docker compose up --build     # first build takes a few minutes
```

Open **http://localhost:5180**.

Without an API key the app still works: ballpark, soft check and offer cards are pure code. The assistant answers "unavailable", which is the designed behaviour when the model can't be reached.

### Demo walkthrough

The same steps as the demo video, in one run. The screen is four numbered steps, and the line under the quote bar says what to do next.

**The whole path**

1. **Project:** type the homeowner's name.
2. **Ballpark estimates:** payment ranges for $30,000 against a $300 budget are already showing. No AI involved.
3. **Real offers:** keep "Moderate credit" as the credit mock profile, tick the consent box and **Run soft check**.
4. **Offers:** three cards in a fixed order (lowest total cost, lowest monthly, promo), each with full disclosures; the promo shows the $4,409.69 of deferred interest it can add.

**The assistant** (open it with **Ask the assistant**)

5. Tap **Explain the promo**. The panel shows each stage while it works (reading, writing, checking), then the answer and a "Say it like this" line that includes the APR, term and deferred interest.
6. Ask *"They've got a 780 score, they'll get approved, right?"* The reply is compliance's fixed wording, marked "Fixed wording"; the explaining model isn't called.
7. Ask *"Is the promo basically free?"* The answer says it isn't, and why.

**The record**

8. Open **Compliance view** (top right): a checklist for the quote, then a timeline with each draft's checks (numbers, decisions, marketing, spoken disclosures, meaning), what was shown and what was said aloud. A draft that broke a rule shows as blocked, next to the rewrite that passed. The technical record is folded under each step.

**Budget first**

9. **Back to the quote**, then **Start new quote**, and type the homeowner's name. Open the assistant and tap *"$25K roof, they can do $250 a month"*. The suggested amount and budget appear in step 1; nothing changes until you tap **Apply**.

**The decline path**

10. Type a name, pick "No offers (decline scenario)" as the credit mock profile, tick the consent box and run the check. Ask *"Why were they turned down?"*: the reply is fixed wording, and the assistant doesn't guess.

## Tests and evals

```bash
docker compose run --rm test       # server: typecheck + 177 unit and HTTP tests, model faked at the boundary
docker compose run --rm web-test   # web: typecheck + 30 component, client and App tests
docker compose run --rm evals      # real models: 42 cases on 4 screens, run twice; needs ANTHROPIC_API_KEY
docker compose run --rm redteam    # Promptfoo red team against a throwaway API instance; needs ANTHROPIC_API_KEY
```

Eval results are written to `server/evals/results/` and summarised in [docs/EVALS.md](docs/EVALS.md).

The red team ([redteam/](redteam/)) uses [Promptfoo](https://www.promptfoo.dev/): Claude writes attacks against our own rules (credit decisions, steering, "interest-free", invented numbers, advice and promises, off-topic use), some disguised in leetspeak, base64 or rot13, and grades each answer. It runs against its own copy of the service (`redteam-api`), so the demo's audit data is untouched. Promptfoo's cloud generation, sharing and telemetry are switched off, and it gets only the API key. Results: `redteam/results/summary.md`, `latest.html` and `latest.json`. Afterwards, stop the throwaway API with `docker compose --profile tools down`.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `.env` | Real model calls (assistant, evals). Optional for the app. |
| `DB_PATH` | compose | SQLite audit store, in the `audit-data` volume. |
| `PORT` | optional | API port inside the network; defaults to 4100. |
| `RATE_LIMIT_PER_HOUR`, `RATE_LIMIT_PER_DAY` | optional | Questions per contractor; default 30 and 200. The red-team API raises them. |
| `RATE_LIMIT_ALL_PER_DAY` | `fly.toml` | One cap on questions across all contractors in 24 hours; none by default. The public deployment sets 300, because anyone can send any contractor header there. |
| `STATIC_DIR` | `Dockerfile` | The built web app, served by the API in the public deployment. Unset locally, where nginx serves it. |

Ports on your machine: **5180** (web), **4100** (API). Contractor identity comes from the `x-contractor-id` header; in the portal, authentication happens upstream.

## How it's built

```
web/       React app (four guided steps, assistant chat, compliance page), served by nginx
server/
  src/quote.ts           payment maths, ballpark, three cards, disclosures, figures   ← every number starts here
  src/guard.ts           G-1 to G-4: no model-written numbers, no decisions, no steering, disclosures spoken
  src/render.ts          fills {{placeholders}} with figures
  src/inputs.ts          G-5: the model may copy numbers the contractor typed, never invent them
  src/assist.ts          the pipeline: understand → suggest | explain → guard → meaning check → retry → fallback
  src/anthropicModel.ts  Haiku 5.5 (understand, check), Sonnet 5.5 (explain); structured outputs
  src/prompts.ts         versioned prompts (understand@3, explain@12, meaning@8)
  src/compliance-rules.json  phrase lists, fixed wording and screen wording, owned by compliance
  src/audit.ts, schema.ts    append-only audit tables (SQLite here, Postgres in production)
  src/app.ts             HTTP routes and rate limit
  src/ports.ts, mocks/   production interfaces; mock loan catalog and credit decision engine
  evals/                 eval cases, graders, Opus 5.5 judges
redteam/   Promptfoo red team: attacks written and graded by Claude against our own rules
docs/      PRD, design, solution blueprint (PDF and HTML), architecture, data model, roadmap,
           evals and saved eval runs, issue log, AI log
```

Architecture and sequence diagrams: [docs/architecture.md](docs/architecture.md). Tables: [docs/data-model.md](docs/data-model.md).

## Deploy to Fly.io (the public demo)

The root `Dockerfile` builds one image that serves the web app and the API from one port; `fly.toml` runs it on one always-on machine with the audit store on a volume. With [flyctl](https://fly.io/docs/flyctl/) signed in:

```bash
fly apps create gl-loanappassist
fly volumes create audit_data --region iad --size 1 -y
grep '^ANTHROPIC_API_KEY=' .env | fly secrets import   # the key goes to Fly secrets, never into the image
fly deploy --ha=false                                  # one machine: the SQLite volume belongs to one machine
```

The assistant answers at most 300 questions a day across all visitors (`RATE_LIMIT_ALL_PER_DAY`); after that it says the demo's daily limit is reached, and the ballpark, cards and compliance view keep working.

## Deployment guide (production)

Each prototype piece has a production counterpart on the company's AWS stack:

1. **Assistant service** → build the `runtime` target of `server/Dockerfile`, push to ECR, run on ECS Fargate next to the portal API (health check `GET /health`).
2. **Audit store** → RDS Postgres. Port the SQLite DDL in `server/src/schema.ts` (identity columns instead of `AUTOINCREMENT`, numeric types for money); append-only comes from the service's role having only `INSERT` and `SELECT`. Nightly export to S3 with Object Lock.
3. **Adapters** → replace `server/src/mocks/` with clients for the loan catalog, contractor profile and credit decision engine (`ports.ts` interfaces).
4. **Secrets** → `ANTHROPIC_API_KEY` from AWS Secrets Manager.
5. **UI** → the panel components move into the partner portal; `x-contractor-id` comes from the portal's session.
6. **Escalations** → point `escalation.ts` at the Zapier webhook that opens JSM tickets.
7. **CI/CD** → lint → unit tests → eval suite (gate) → build → staging smoke → canary → monitor.

## AI usage

Built with Claude Code. How AI was used, and every decision the AI made itself, is in [docs/AI_LOG.md](docs/AI_LOG.md). Each slice was reviewed by two AI reviewers (coding standards, and against the PRD); small follow-up changes got one review. The findings and fixes are in the merge requests.
