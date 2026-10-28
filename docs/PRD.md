# PRD: On-site Financing Assistant

Status: locked for build · 2026-10-28

## Problem

Contractors lose deals in the homeowner's kitchen because they can't quickly and correctly explain financing. The partner portal already returns real offers from a soft credit check within seconds. What fails is the conversation around those offers: a monthly payment the homeowner can believe, why one offer differs from another, and what a promotional term really costs. Product selection is where most applications are abandoned (38% overall).

We give the contractor a ballpark payment within 30 seconds and a plain-language comparison of real offers. Both are framed around the question the homeowner is actually asking: "can I afford this each month?"

**It must never be wrong about this:** every number comes from the catalog or the decision engine and is calculated in code. Nothing suggests the homeowner will or won't be approved. No payment is ever shown without the APR, term and promo conditions that go with it.

## Users and moment

- **Contractor (operator):** a sales rep on a tablet in the homeowner's kitchen. Sells roofs, not credit. Has about 30 seconds before the conversation goes cold.
- **Homeowner (reader):** sees the screen. Facing a large, unplanned expense, wary of being upsold, and confused by "0% for 12 months". Every output is treated as borrower-facing.

## The flow

1. **Ballpark, with no homeowner data.** The contractor enters the project type and amount, and optionally the homeowner's monthly budget. Payment ranges appear across the contractor's products.
2. **Real offers, after consent.** The contractor records the homeowner's consent to a soft credit check. The mocked decision engine returns offers, and the three most useful are shown as cards.
3. **AI assistant, on demand.** A side panel, closed by default, explains the cards on screen and answers the contractor's questions. The cards work without it.

## Functional requirements

**Ballpark**
- **FR-1** Given a project amount ($5K–$100K) and type, show monthly payment ranges for each available term. The low end uses the lowest APR among the contractor's enrolled fixed-rate products, the high end the highest. Never "as low as" a single best rate. Promo products are left out of the ballpark, because a 0% teaser payment shown without its cliff misleads. Promos appear only as real offers, always with the cliff line.
- **FR-2** Given a monthly budget, label each term *fits at any rate*, *fits at some rates* or *doesn't fit*, all computed in code.
- **FR-3** Ballpark results render without any LLM call and within 1 s of input.

**Offers**
- **FR-4** The soft-check button stays disabled until a consent box is ticked. The audit log records consent with a timestamp and the contractor's ID.
- **FR-5** The mocked engine returns an offer set chosen by a fixture homeowner (strong, moderate, no offers).
- **FR-6** Show at most 3 offer cards, chosen by a fixed rule: **Lowest monthly**, **Lowest total cost** and **Promo** (if any; otherwise the next lowest total cost). Each card is labelled by what it's best at and never as "recommended". The cards always appear in the same order, **Lowest total cost, Lowest monthly, Promo**, with no visual emphasis except the homeowner's own budget label (FR-8). Order is itself a nudge, so it's fixed and documented. Labels must always be true: if one offer has both the lowest total cost and the lowest monthly payment, its card says so ("Lowest total and monthly"), and the free slot goes to the next lowest total cost. Promos compete only for the promo slot, never for lowest monthly. A "See all N offers" link always shows the full set, with the same disclosures.
- **FR-7** Every card displays the monthly payment, APR, term, number of payments, amount financed, finance charge and total of payments. A promo card adds the conditions (pay off the amount financed within the promo months), plus a **cliff line**: the deferred interest that is added if the balance isn't paid off in time.
- **FR-8** Given a budget, each offer card shows *fits budget* (and by how much it's under) or *over by $X*. Budget is optional. Without one, the cards leave out the fit labels, and the assistant suggests the contractor ask: "What monthly amount would feel comfortable?" "As low as possible" is never treated as a budget, because that would push the longest, most expensive term.

**AI assistant**
- **FR-9** The panel is closed by default and opened by a button. Closing it never changes the cards.
- **FR-10** The contractor can ask a free-text question about the cards on screen (for example "explain the promo", "compare 1 and 2", "what if she pays early?"). The assistant answers in plain language and adds a short "say it like this" line for the homeowner.
- **FR-10a** Explanations of product terms (deferred interest, prepayment, promo conditions) use only the compliance-approved plain-language text stored with each product in the catalog. The model may shorten or simplify that text but not add terms of its own. It's a catalog lookup, not retrieval (see D-1).
- **FR-11** The model never writes digits. It refers to figures by placeholder (for example `{{lowest_total.monthly}}`), and code fills them from the calculator's output for offers currently on screen.
- **FR-12** Every answer passes the guard (G-1 to G-4) before it is shown.
- **FR-13** An inputs panel (amount, project type, monthly budget) is always visible and is the only place numbers enter the quote. The contractor can type into it directly, or type in the chat the way homeowners talk ("$30K roof, she can do $300 a month", "drop it to $25K"). Numbers typed in the chat appear as **suggested changes** in the inputs panel, and nothing reruns until the contractor taps Apply. **The AI can suggest inputs; only the contractor can apply them.** Questions ("what's deferred interest?") are answered in the chat. Budget-first requests are the main case, not an edge case.

**Guard (rules live in one compliance-owned file)**
- **G-1** *Number fidelity:* every number the homeowner sees or hears comes from code. Model output fails if it contains:
  - a digit outside a resolved placeholder; terms and months count too (`{{lowest_monthly.term_years}}`)
  - a spelled-out number ("twenty-four thousand")
  - a placeholder that doesn't match an offer on screen

  Placeholder names follow the card label, and each label appears once per screen. Which names exist depends on the offers (for example, `diff.*` only exists when lowest total and lowest monthly are different cards), so the explain prompt is given the list of names that exist for this screen, never a fixed list.

  The calculator exposes each figure in exact form. **Only lifetime totals of $1,000 or more** (total of payments, finance charge, and the difference in total cost) also get a rounded form for the "say it like this" line (`{{diff.total.rounded}}` → "about $24,000"). Monthly payment, APR, term, number of payments and the promo cliff are always exact; no rounded form of them exists. A what-if with no matching figure goes back through the calculator; the model never estimates it.
- **G-2** *No credit decisions, no recommendations:* the assistant may compare offers against what the homeowner said ("under her $300 budget, only the 20-year fits"). It may never say she'll be approved, or which offer she should pick.
- **G-3** *No misleading marketing or pressure:* no "free", no "no interest" on a deferred-interest product, no "best deal", no pushing her past her own budget ("stretch to").
- **G-2 and G-3 are checked in three layers:**
  1. **Phrase list:** code blocks known phrases from the rules file. Fast, and the reason for each block is obvious.
  2. **Meaning check:** Haiku answers one yes/no question: "Does this suggest approval, or which offer to pick, or use misleading terms?" It quotes the phrase it flagged. This catches rewordings the list misses.
  3. **Evals:** about 20 tricky rewordings must all be blocked. This measures what the first two layers miss.
- **G-4** *Disclosure completeness:* the renderer refuses to show any payment without the FR-7 fields. This is enforced in code, not by the model. **The spoken line counts too:** if the "say it like this" line mentions an offer's monthly payment, it must also include that offer's APR and term placeholders ("$289.31 a month for 20 years at 9.99% APR"), or the guard fails it.
- **G-5** *Input fidelity:* every number the assistant extracts in FR-13 must appear in the contractor's text, allowing normalisation such as "30K" → 30000 and "$300/mo" → 300. Otherwise the field stays empty and the contractor is asked for it. The model may copy numbers but never invent them.

**Audit**
- **FR-14** Each assistant turn (including FR-13 extractions and G-5 results) logs:
  - the question
  - the offers on screen
  - the catalog version
  - the calculator's output
  - the prompt version and model ID
  - the model's raw text
  - each guard result (pass or fail, with the reason)
  - the rendered text
- **FR-15** A "Compliance view" toggle shows that record for each turn.

**Cost limits (apply to every flow that calls a model)**
- **FR-16** Each question has a fixed cost ceiling: a fixed pipeline with no agent loop, at most one retry, capped response length, and only the last 4 turns sent. Worst case is about 3¢; typical is about 1.5¢.
- **FR-17** Each contractor gets a rate limit, for example 30 questions an hour and 200 a day. Ballpark and offer cards make no model call and aren't limited.
- **FR-18** Token usage is logged in each audit record, so cost per contractor can be tracked. In production: cached repeat answers, an org-wide spending cap with alerts, and a Jira ticket raised on unusual spikes.

## Non-goals (enforced as behaviour)

- **NG-1** Never estimates, predicts or explains an approval, decline or credit tier. Questions like "will she qualify?" are redirected to the soft check.
- **NG-2** Never explains why an applicant received no offers. The UI says the lender will send the homeowner a notice, which is the lender's adverse-action duty, not the assistant's.
- **NG-3** Never ranks offers as "best for you" or recommends one. It only describes trade-offs against the homeowner's stated budget.
- **NG-4** Never collects homeowner data before consent. The ballpark takes none.
- **NG-5** Never answers outside financing for this project (tax advice, tax-credit eligibility, legal questions, other products). It says so and suggests who to ask.
- **NG-6** Not built: document extraction, Plaid income verification, submitting the application, voice. These are covered in the design doc as later phases.

## Guarantees the platform doesn't provide (this build owns them)

The engine, catalog and contractor profile are mocks. Production services wouldn't guarantee these either:

- **Disclosure attached to every payment shown.** The catalog returns rates, not disclosure-ready figures. Our calculator produces the FR-7 fields, so it owns them.
- **No model-generated numbers.** No LLM API enforces this. G-1 does.
- **Audit of what was said and why.** The portal logs applications, not conversations. FR-14 owns this.
- **Consent before the soft check.** The mock doesn't check it. FR-4 does.

## Failure behaviour

Each outcome is separate and visible to the contractor:

- **F-1 Guard fails once:** regenerate once, passing the failure reason to the model.
- **F-2 Guard fails twice:** show a fixed, code-written explanation of the card, labelled "standard explanation". This is logged.
- **F-3 Out of scope (NG-1, NG-5):** a short redirect that offers the next step. Not shown as an error.
- **F-4 LLM unavailable or slow (over 10 s):** the panel shows "Assistant unavailable"; the cards are unaffected.
- **F-5 No offers:** a neutral message per NG-2, and the panel won't speculate about the reason.
- **F-6 Input outside catalog bounds** (for example $150K): the ballpark explains the $5K–$100K range. No guessing.

## Success metrics

| # | Metric | Baseline | Target |
|---|---|---|---|
| **Prototype (eval suite)** | | | |
| M-1 | Rendered numbers traceable to calculator output; extracted inputs traceable to the contractor's text | — | 100% |
| M-2 | Adversarial prompts blocked or redirected | — | 100% |
| M-3 | Normal questions wrongly blocked *(counter-metric to M-2)* | — | ≤ 5% |
| M-4 | Ballpark render time | — | < 1 s |
| M-5 | Assistant answer, p95 | — | < 8 s |
| **Pilot (production)** | | | |
| M-6 | Time to first payment quote on-site | Unknown — **open item** | ≤ 30 s |
| M-7 | Application completion time | 22 min | < 10 min |
| M-8 | Abandonment at product selection | Biggest drop-off; exact rate unknown — **open item** | −25% relative |
| M-9 | Overall abandonment | 38% | ≤ 30% |
| M-10 | Pilot contractors using it weekly | 0 | ≥ 50% |
| M-11 | Deferred-interest promos that hit the cliff *(counter-metric to M-8/M-9)* | Pull from Snowflake | Must not rise |

M-11 exists because the quickest way to cut abandonment is to push 0% promos. If closure rises and cliff hits rise with it, the assistant is overselling.

## Decision notes

**D-1 No RAG in v1. It belongs to phase 2.**

*Why it doesn't fit the problem.* The catalog is structured data behind an API: rates, terms and eligibility. You query it; you don't search it, however many products there are. Numbers never come from retrieval. The one piece of text the assistant needs, the plain-language description of each product's terms, is short, approved by compliance, and stored with the product (FR-10a). Looking it up by product ID is exact; searching for it by similarity could return the wrong product's terms.

*Why it doesn't fit a short project.* The brief recommends 1–2 hours and says a focused submission beats a sprawling one. A RAG pipeline that's safe in a regulated setting needs more than wiring up a vector store:
- choosing how to split documents and which embedding model to use
- a test set proving the right passage comes back for each question
- handling the cases where retrieval returns nothing, or the wrong thing
- versioning the indexed documents, so the audit trail can show which text was used

An untested retriever in front of borrower-facing answers is a liability, not a feature. Built in an hour, it would show technique without solving a v1 problem, and take time from the guard and evals that do.

*When it earns its place.* Phase 2, when there is real unstructured text: policy FAQs, product terms documents, and uploaded pay stubs and estimates for document extraction. That phase has time for a retrieval test set.

## Assumptions (stated in the design doc)

- **A-1** The brief doesn't say how many products exist. The mock catalog uses a small set chosen by us: fixed-rate terms of 5–25 years and one deferred-interest promo. No origination or dealer fees. Fee transparency is noted as a future guard.
- **A-2** The loans are treated as unsecured. RESPA mainly covers loans secured by real estate, but we apply its anti-steering principle anyway (NG-3).
- **A-3** Reg Z triggering terms for advertising (§1026.24(d)) are used as the disclosure standard for every quoted payment.
- **A-4** Contractor identity and authentication are handled upstream by the portal.
- **A-5** The pilot targets M-8 to M-10 are proposals to set with the stakeholders, not commitments the brief makes.
- **A-6** *Promo cliff:* during the promo no interest is charged, so each payment reduces principal. Interest still builds on that falling principal and is all added if the balance isn't cleared in time. The brief doesn't define this; it's our model.
- **A-7** *Total of payments* is the rounded monthly payment × number of payments, ignoring the small final-payment adjustment real loans make.
