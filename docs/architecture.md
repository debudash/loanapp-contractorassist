# Architecture

How the on-site financing assistant is built. Requirements and IDs (FR-, G-, NG-) are in [PRD.md](PRD.md).

**Two rules shape everything below:**
- Numbers come only from code. The model explains; the quote engine calculates.
- The AI can suggest; only the contractor applies. The cards work with the AI switched off.

## 1. High-level architecture

```mermaid
flowchart LR
  C([Contractor on a tablet<br/>homeowner reading along])

  subgraph Portal["Partner portal · React"]
    IP[Inputs panel]
    OC[Offer cards]
    AP[Assistant panel<br/>closed by default]
    CV[Compliance view]
  end

  subgraph Svc["Assistant service · Node / TypeScript"]
    Q[Quote engine<br/>code only]
    A[Assist pipeline]
    G[Guard]
    AU[Audit writer]
    RL[Rate limit]
  end

  subgraph Existing["Existing company services · mocked"]
    CAT[(Loan catalog +<br/>contractor profile)]
    DE[(Credit decision engine<br/>soft check)]
    ESC[(Zapier → JSM)]
  end

  LLM[[Anthropic API<br/>Haiku 5.5 · Sonnet 5.5]]
  LOG[(Audit store<br/>SQLite locally)]

  C --> Portal
  IP --> Q
  OC --> Q
  AP --> RL --> A
  CV --> AU
  Q --> CAT
  Q --> DE
  A --> Q
  A --> LLM
  A --> G
  G --> LLM
  A --> AU --> LOG
  G -. fails twice .-> ESC
```

| Box | Prototype | Production |
|---|---|---|
| Partner portal | React + Vite app | Panel inside the existing portal |
| Assistant service | Express in Docker | ECS Fargate service |
| Catalog, profile, decision engine | In-process mocks, same interfaces | Existing internal APIs |
| Audit log | SQLite tables, append-only by trigger ([data-model.md](data-model.md)) | RDS Postgres (append-only) + S3 Object Lock |
| Zapier → JSM | Stub that logs the ticket | Zapier webhook to Jira Service Management |
| Anthropic API | Real calls | Real calls, key in Secrets Manager |

### Runtime: everything runs in Docker

Nothing runs on the host: not the app, not the tests, not the evals. One `docker compose` file defines every service.

| Service | What it runs | Command |
|---|---|---|
| `api` | Express assistant service | `docker compose up` |
| `web` | React app (Vite build) | `docker compose up` |
| `test` | Unit and integration tests (Vitest), no API key needed | `docker compose run --rm test` |
| `evals` | Eval suite against the real model | `docker compose run --rm evals` |

The only thing needed on the host is Docker, plus an `ANTHROPIC_API_KEY` in `.env` for the app and evals.

## 2. Low-level architecture

Each module is one file with one job. **Bold** interfaces are the test seams.

```mermaid
flowchart TB
  subgraph routes["routes.ts · HTTP"]
    R1["POST /ballpark"]
    R2["POST /offers"]
    R3["POST /assist"]
    R0["POST /sessions"]
    R4["GET /sessions/:id/audit"]
  end

  subgraph quote["Quote engine · pure functions"]
    QB["ballpark()"]
    QP["presentOffers()"]
    QF["figures()"]
    AM["amortize.ts"]
  end

  subgraph assist["Assist pipeline"]
    AS["assist()"]
    UN["understand.ts · Haiku"]
    IC["checkInputs() · G-5"]
    EX["explain.ts · Sonnet"]
    GU["guard() · G-1 to G-4"]
    MC["meaningCheck() · Haiku"]
    RE["render()"]
    FB["fallback.ts"]
  end

  subgraph adapters["Adapters · interfaces with mock implementations"]
    LC["LoanCatalog"]
    DEI["DecisionEngine"]
    AL["AuditStore"]
    ES["Escalation"]
    MD["Model (Anthropic client)"]
  end

  RULES[("compliance-rules.json")]

  R1 --> QB
  R2 --> DEI
  R2 --> QP
  R3 --> AS
  R4 --> AL
  QB --> LC
  QB --> AM
  QP --> AM
  AS --> UN --> MD
  AS --> IC
  AS --> EX --> MD
  AS --> GU --> RULES
  AS --> MC --> MD
  AS --> RE
  AS --> FB
  AS --> QF
  AS --> AL
  AS --> ES
```

### Interfaces

```ts
// Adapters: the mock and the real service implement the same interface.
interface LoanCatalog {
  version: string;
  productsFor(contractorId: string): Product[];        // enrolled products only
}
interface DecisionEngine {
  softCheck(req: { applicantRef: string; amount: number }): Promise<Offer[]>;  // [] means no offers
}
// AuditStore (SQLite, append-only): ensureSession, recordConsent, recordOfferSet, recordTurn, sessionTrail.
// Tables and columns: docs/data-model.md
interface Escalation { raise(ticket: { reason: string; turnId: string }): void }

// Quote engine: pure, no I/O, no model.
function ballpark(input: { amount: number; budget?: number }, products: Product[]): BallparkResult;
//   -> { ok: true, aprMin, aprMax, rows } | { ok: false, reason: "amount_out_of_range" | "no_products" }
function presentOffers(offers: Offer[], budget?: number): { cards: Card[]; allOffers: DisclosedOffer[]; totalCount: number };
function figures(cards: Card[]): Figures;   // "lowest_monthly.monthly" -> "$289.31"; lifetime totals also get ".rounded"

// Assist pipeline.
function guard(draft: Draft, screen: Screen): { pass: boolean; failures: Failure[] };  // G-1 to G-4, deterministic
//   Draft = { answer, say }   Screen = { figures, promoOnScreen }   rules: compliance-rules.json
function checkInputs(message: string, suggested: SuggestedInputs): { inputs: SuggestedInputs; dropped: ("amount" | "budget")[] }; // G-5
function render(text: string, figures: Figures): string;   // render.ts also owns the {{placeholder}} syntax
function assist(req: { sessionId; contractorId; message }, deps: { model, audit, catalog, escalate }): Promise<AssistResult>;
//   AssistResult = suggestion { inputs, dropped } | answer { outcome, answer, say } | unavailable { message }
interface Model {   // anthropicModel.ts: Haiku 5.5 (understand, meaningCheck), Sonnet 5.5 (explain)
  understand(message): Understanding;        // inputs | question | credit_decision | off_topic
  explain(request: ExplainRequest): Draft;   // { answer, say } with {{placeholders}}
  meaningCheck(draft): MeaningVerdict;       // { pass, quote, reason }
}
```

### Test seams

| Seam | Tested with | Faked at the boundary |
|---|---|---|
| `ballpark()`, `presentOffers()`, `figures()` | Worked examples (known amortization values) | Nothing: pure functions |
| `guard()`, `checkInputs()`, `render()` | Pass and fail drafts per rule | Nothing: pure functions |
| `assist()` | Lane routing, retry, fallback, audit record | `Model`, `AuditStore`, `Escalation` |
| HTTP routes | Consent required, rate limit, status codes | Adapters |
| Real model behaviour | Eval suite | Nothing: real API calls |

## 3. Sequence diagrams

### 3.1 Ballpark: no homeowner data, no AI

```mermaid
sequenceDiagram
  actor C as Contractor
  participant UI as Portal
  participant S as Service
  participant Q as Quote engine
  participant CAT as LoanCatalog

  C->>UI: Amount, project type, budget (optional)
  UI->>S: POST /ballpark
  S->>CAT: productsFor(contractorId)
  CAT-->>S: Enrolled products
  S->>Q: ballpark(input, fixed-rate products only)
  Q-->>S: Range per term, fit label if budget given
  S-->>UI: Rows + disclosure line
  UI-->>C: Ballpark table in under 1 second
```

### 3.2 Consent and soft check: real offers

```mermaid
sequenceDiagram
  actor C as Contractor
  participant UI as Portal
  participant S as Service
  participant DE as DecisionEngine
  participant Q as Quote engine
  participant AL as AuditStore

  C->>UI: Ticks "homeowner consents to a soft check"
  C->>UI: Run soft check
  UI->>S: POST /offers (consent: true)
  alt consent missing
    S-->>UI: 400, nothing called
  else consent given
    S->>AL: recordConsent(session, wording version)
    S->>DE: softCheck(applicant, amount)
    DE-->>S: Offers, or none
    alt no offers
      S-->>UI: "The lender will send the homeowner a notice"
    else offers
      S->>Q: presentOffers(offers, budget)
      Q-->>S: 3 cards in fixed order, disclosures, cliff, fit labels
      S-->>UI: Cards + "See all N offers"
    end
  end
```

### 3.3 Assistant question: explain, guard, retry, render

```mermaid
sequenceDiagram
  actor C as Contractor
  participant UI as Assistant panel
  participant S as assist()
  participant M as Model
  participant G as Guard
  participant AL as AuditStore
  participant E as Escalation

  C->>UI: "Which one should she go with?"
  UI->>S: POST /assist (question, cards on screen)
  S->>M: Haiku: new inputs or a question?
  M-->>S: Question
  S->>M: Sonnet: explain with placeholders only,<br/>terms text from catalog only
  M-->>S: Draft
  S->>G: Rules check G-1 to G-4
  S->>M: Haiku meaning check
  alt passes
    S->>S: render(): fill placeholders from figures
  else fails once
    S->>M: Sonnet again, with the failure reason
    M-->>S: Second draft, checked the same way
  else fails twice
    S->>S: Fixed explanation written in code
    S->>E: raise(ticket)
  end
  S->>AL: recordTurn(question, raw text, verdicts, rendered text, model, versions, tokens)
  S-->>UI: Answer + "say it like this" line
```

### 3.4 Chat with new numbers: the AI suggests, the contractor applies

```mermaid
sequenceDiagram
  actor C as Contractor
  participant UI as Portal
  participant S as assist()
  participant M as Model
  participant Q as Quote engine

  C->>UI: "Drop it to $25K, she can do $250"
  UI->>S: POST /assist
  S->>M: Haiku: new inputs or a question?
  M-->>S: Inputs { amount: 25000, budget: 250 }
  S->>S: checkInputs(): every number must appear in the message (G-5)
  S-->>UI: Suggested changes
  UI-->>C: Inputs panel shows "Amount $25,000 · Budget $250 · Apply"
  C->>UI: Apply
  UI->>Q: Ballpark and offers rerun with the new inputs
```

## 4. Build plan

Built in vertical slices, test-first. Each slice is a GitLab merge request: built on a branch, reviewed on two axes (coding standards, and the spec in [PRD.md](PRD.md)), fixed test-first, then squash-merged. The review findings and their fixes stay in the merge request.

| # | Slice | Seams under test | Status |
|---|---|---|---|
| 1 | Quote engine: payment maths, ballpark, budget fit, three cards, cliff, disclosures, figures | `ballpark()`, `presentOffers()`, `figures()` | Done (`0b7c51e`) |
| 2 | Guard and render: placeholders, G-1 to G-5 rule checks, compliance rules file | `render()`, `guard()`, `checkInputs()` | Done (MR 1) |
| 3 | Decision engine mock, consent, audit store | `POST /sessions`, `/offers`, `/ballpark`, `GET /sessions/:id/audit` | Done (MR 2) |
| 4 | AI steps: understand, explain, meaning check, retry and fallback | `assist()` with the model faked at the boundary | Done (MR 3) |
| 5 | API wiring, rate limit, server and Docker runtime | `POST /api/assist`, `GET /health` | In progress |
| 6 | React UI: inputs panel, cards, assistant panel, compliance view | Manual check plus a few component tests | |
| 7 | Evals against the real model | Eval suite | |
| 8 | Docker run, README, design doc | `docker compose up` | |
