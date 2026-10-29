# On-site financing assistant

A contractor in a homeowner's kitchen types *"$30K roof, she can do $300 a month"* and sees payment ranges straight away. After a soft credit check, three real offers appear with every disclosure. An assistant explains them in plain language.

The assistant is designed so the model never writes a figure, never makes or hints at a credit decision, and never steers the homeowner. Each rule is enforced in code and measured by evals. Every answer is recorded for compliance.

Built for the AI Solutions Engineer take-home. Design document: [docs/DESIGN.md](docs/DESIGN.md).

## Run it

You need Docker. Nothing else runs on your machine. The first build downloads dependencies and takes a few minutes; after that the stack starts in seconds.

```bash
cp .env.example .env          # optional: add ANTHROPIC_API_KEY to enable the assistant
docker compose up --build     # first build takes a few minutes
```

Open **http://localhost:5180**.

Without an API key the app still works: ballpark, soft check and offer cards are pure code. The assistant answers "unavailable", which is the designed behaviour when the model can't be reached.

### A two-minute demo

The screen is four numbered steps, and the line under the quote bar says what to do next.

1. **Project:** type the homeowner's name.
2. **Ballpark estimates:** payment ranges for $30,000 against a $300 budget are already showing. No AI involved.
3. **Real offers:** keep "Moderate credit" as the credit mock profile, tick the consent box and **Run soft check**.
4. **Offers:** three cards appear: lowest total cost, lowest monthly, promo, each with full disclosures; the promo shows its $4,409.69 cliff.

Then open the assistant (right-hand column). Tap a suggested prompt, or ask "Is the promo basically free?", "She's got a 780 score, she'll get approved right?", or "drop it to $25K, she can do 250" (then tap **Apply** in step 1).

**Compliance view** (top right) is the back-office page for this quote: a checklist (consent before every soft check, every answer passed every check, drafts blocked, tickets, redirects), then a timeline showing each draft's checks and what was shown. The technical record is folded under each step.

Pick "No offers (decline scenario)" as the credit mock profile, or "Valley HVAC" as the contractor, for the other paths.

## Tests and evals

```bash
docker compose run --rm test       # server: typecheck + 172 unit and HTTP tests, model faked at the boundary
docker compose run --rm web-test   # web: typecheck + 29 component, client and App tests
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
docs/      PRD, design, architecture, data model, roadmap, evals, issue log, AI log
```

Architecture and sequence diagrams: [docs/architecture.md](docs/architecture.md). Tables: [docs/data-model.md](docs/data-model.md).

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

Built with Claude Code. How AI was used, and every decision the AI made itself, is in [docs/AI_LOG.md](docs/AI_LOG.md). Each slice was reviewed by two AI reviewers (coding standards, and against the PRD); the findings and fixes are in the merge requests.
