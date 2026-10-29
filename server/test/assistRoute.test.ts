import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, DEFAULT_LIMITS, type Deps, limitsFromEnv } from "../src/app.js";
import { AuditStore } from "../src/audit.js";
import rules from "../src/compliance-rules.json" with { type: "json" };
import { mockCatalog } from "../src/mocks/catalog.js";
import { MockDecisionEngine } from "../src/mocks/decisionEngine.js";
import { FakeModel } from "./fakeModel.js";

const asSummit = { "x-contractor-id": "c_summit" };
const credit = { kind: "credit_decision" as const };

async function setup(overrides: Partial<Deps> = {}) {
  const audit = new AuditStore(":memory:");
  const model = new FakeModel();
  const app = createApp({
    catalog: mockCatalog,
    engine: new MockDecisionEngine(),
    audit,
    model,
    escalate: (turnId) => `JSM-STUB-${turnId}`,
    ...overrides,
  });
  const sessionId = (await request(app).post("/api/sessions").set(asSummit)).body.sessionId as string;
  const ask = (message = "Will she qualify?") => request(app).post("/api/assist").set(asSummit).send({ sessionId, message });
  const trail = async () => (await request(app).get(`/api/sessions/${sessionId}/audit`).set(asSummit)).body;
  return { app, model, sessionId, ask, trail };
}

describe("POST /api/assist", () => {
  it("returns the assist pipeline's result for a fixed-wording redirect", async () => {
    const { model, ask } = await setup();
    model.understandings.push(credit);

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "answer", outcome: "redirected" });
  });

  // The UI shows each stage as it happens; the plain JSON answer stays for every other caller.
  it("streams each stage, then the result, as JSON lines when the client asks for them", async () => {
    const { model, sessionId, app } = await setup();
    model.understandings.push(credit);

    const res = await request(app)
      .post("/api/assist")
      .set({ ...asSummit, accept: "application/x-ndjson" })
      .send({ sessionId, message: "Will she qualify?" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.headers["x-accel-buffering"]).toBe("no"); // so nginx passes each line straight on
    const lines = res.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([{ stage: "reading" }, { result: expect.objectContaining({ kind: "answer", outcome: "redirected" }) }]);
  });

  // MR 20 review: once a stream has started its status is sent, so a defect must end it with an error line.
  it("ends a stream with an error line when something other than the model fails", async () => {
    const model = new FakeModel();
    model.understand = async () => {
      throw new Error("a defect, not a model failure");
    };
    const { sessionId, app } = await setup({ model });

    const res = await request(app)
      .post("/api/assist")
      .set({ ...asSummit, accept: "application/x-ndjson" })
      .send({ sessionId, message: "Explain the promo" });

    expect(res.text.trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ stage: "reading" }, { error: "internal_error" }]);
  });

  // MR 20 review: an Accept header listing other types too still gets the stream.
  it("streams when the Accept header lists JSON lines among other types", async () => {
    const { model, sessionId, app } = await setup();
    model.understandings.push(credit);

    const res = await request(app)
      .post("/api/assist")
      .set({ ...asSummit, accept: "application/x-ndjson, */*" })
      .send({ sessionId, message: "Will she qualify?" });

    expect(res.headers["content-type"]).toContain("application/x-ndjson");
  });

  it("stops a contractor at the hourly limit, and records the refusal (FR-17)", async () => {
    const { model, ask, trail } = await setup({ limits: { perHour: 2, perDay: 200 } });
    model.understandings.push(credit, credit);

    await ask();
    await ask();
    const third = await ask();

    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: "rate_limited", message: "Question limit reached for now. The cards and figures still work." });
    expect((await trail()).turns.map((t: { outcome: string }) => t.outcome)).toEqual(["redirected", "redirected", "rate_limited"]);
  });

  it("applies the daily limit too", async () => {
    const { model, ask } = await setup({ limits: { perHour: 30, perDay: 1 } });
    model.understandings.push(credit);

    await ask();

    expect((await ask()).status).toBe(429);
  });

  // Public deployment: the contractor header is set by the caller, so one cap across everyone bounds model spend.
  it("applies a daily cap across all contractors when one is set", async () => {
    const { app, model, ask } = await setup({ limits: { perHour: 30, perDay: 200, allPerDay: 1 } });
    model.understandings.push(credit);
    await ask();

    const asValley = { "x-contractor-id": "c_valley" };
    const other = (await request(app).post("/api/sessions").set(asValley)).body.sessionId as string;
    const res = await request(app).post("/api/assist").set(asValley).send({ sessionId: other, message: "Will he qualify?" });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited", message: "The assistant has reached today's limit for this demo. The cards and figures still work." });
    expect(model.understandCalls).toHaveLength(1);
    const refused = (await request(app).get(`/api/sessions/${other}/audit`).set(asValley)).body.turns;
    expect(refused.map((t: { outcome: string }) => t.outcome)).toEqual(["rate_limited"]);
  });

  // Review fix (slice 5, spec S1): found by spec review; parallel questions all passed the check.
  it("counts questions still in flight, so parallel requests can't pass the limit", async () => {
    const { model, ask } = await setup({ limits: { perHour: 2, perDay: 200 }, deadlineMs: 200 });
    model.hangOn = "understand";

    const statuses = (await Promise.all([ask(), ask(), ask()])).map((r) => r.status).sort();

    expect(statuses).toEqual([200, 200, 429]);
  });

  it("records a rate-limited turn with the offers on screen (FR-14)", async () => {
    const { app, sessionId, ask, trail } = await setup({ limits: { perHour: 0, perDay: 0 } });
    await request(app).post("/api/offers").set(asSummit)
      .send({ sessionId, amount: 30_000, applicantRef: "moderate", consent: { given: true, textVersion: "v1", homeownerName: "Maria Lopez" } });

    await ask();

    const [turn] = (await trail()).turns;
    expect(turn).toMatchObject({ outcome: "rate_limited", offerSetId: expect.any(Number) });
    expect(turn.offersOnScreen).toHaveLength(3);
  });

  it.each([
    ["", { error: "message_required" }],
    ["x".repeat(501), { error: "message_too_long", max: 500 }],
  ])("refuses a bad message before calling the model: %#", async (message, error) => {
    const { model, ask } = await setup();

    const res = await ask(message);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(error);
    expect(model.understandCalls).toEqual([]);
  });

  it("accepts a message of exactly 500 characters", async () => {
    const { model, ask } = await setup();
    model.understandings.push(credit);

    expect((await ask("x".repeat(500))).status).toBe(200);
  });

  it("only works on the contractor's own session", async () => {
    const { app, sessionId } = await setup();

    const res = await request(app).post("/api/assist").set({ "x-contractor-id": "c_valley" }).send({ sessionId, message: "Hi" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "session_not_yours" });
  });

  // Review fix (slice 5, spec S3): found by spec review; bad JSON returned an HTML page.
  it("answers invalid JSON with a JSON error", async () => {
    const { app } = await setup();

    const res = await request(app).post("/api/sessions").set(asSummit).set("content-type", "application/json").send("{oops");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
  });

  it("uses the default limits when none are given", () => {
    expect(DEFAULT_LIMITS).toEqual({ perHour: 30, perDay: 200 });
  });

  it("reads a cap across all contractors from the environment, with none by default", () => {
    expect(limitsFromEnv({}).allPerDay).toBeUndefined();
    expect(limitsFromEnv({ RATE_LIMIT_ALL_PER_DAY: "300" }).allPerDay).toBe(300);
    expect(limitsFromEnv({ RATE_LIMIT_ALL_PER_DAY: "none" }).allPerDay).toBeUndefined();
  });

  // The red-team run uses its own API instance, which needs more questions than a contractor gets.
  it("reads limits from the environment, keeping the defaults for anything missing or invalid", () => {
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    expect(limitsFromEnv({ RATE_LIMIT_PER_HOUR: "1000", RATE_LIMIT_PER_DAY: "5000" })).toEqual({ perHour: 1000, perDay: 5000 });
    expect(limitsFromEnv({ RATE_LIMIT_PER_HOUR: "lots", RATE_LIMIT_PER_DAY: "0" })).toEqual(DEFAULT_LIMITS);
    // MR 22 review: Number() also accepted "1e3" and "0x10".
    expect(limitsFromEnv({ RATE_LIMIT_PER_HOUR: "1e3", RATE_LIMIT_PER_DAY: "0x10" })).toEqual(DEFAULT_LIMITS);
  });
});

describe("POST /api/offers wording", () => {
  // Review fix (slice 5, spec S2): found by spec review; the no-offers wording existed twice.
  it("uses the compliance file's no-offers wording", async () => {
    const { app, sessionId } = await setup();

    const res = await request(app).post("/api/offers").set(asSummit)
      .send({ sessionId, amount: 30_000, applicantRef: "no_offers", consent: { given: true, textVersion: "v1", homeownerName: "Maria Lopez" } });

    // The screen's notice has no "I"; the assistant's own reply after a decline stays fixedWording.noOffers.
    expect(res.body.message).toBe(rules.uiWording.noOffersNotice);
    expect(res.body.message).not.toMatch(/\bI\b/);
  });
});

describe("GET /health", () => {
  it("answers without a contractor identity, after touching the audit store", async () => {
    const { app } = await setup();

    expect((await request(app).get("/health")).body).toEqual({ ok: true });
  });
});

describe("offers on screen", () => {
  // Review fix (slice 6, spec S1): found by spec review; after the inputs changed, the assistant
  // still answered about offers no longer shown.
  it("explains only the offer set the screen says it shows; none after the inputs change", async () => {
    const { app, model, sessionId } = await setup();
    const offers = await request(app).post("/api/offers").set(asSummit)
      .send({ sessionId, amount: 30_000, applicantRef: "moderate", consent: { given: true, textVersion: "v1", homeownerName: "Maria Lopez" } });
    model.understandings.push({ kind: "question" }, { kind: "question" });
    model.drafts.push({ answer: "Here are the options.", say: "Here are the options." }, { answer: "Enter the amount first.", say: "" });
    model.verdicts.push({ pass: true, quote: null, reason: null }, { pass: true, quote: null, reason: null });

    await request(app).post("/api/assist").set(asSummit).send({ sessionId, message: "Compare them", offerSetId: offers.body.offerSetId });
    await request(app).post("/api/assist").set(asSummit).send({ sessionId, message: "Compare them", offerSetId: null });

    expect(model.explainRequests.map((r) => r.cards.length)).toEqual([3, 0]);
  });

  it("refuses an offer set from another session", async () => {
    const { app, sessionId } = await setup();

    const res = await request(app).post("/api/assist").set(asSummit).send({ sessionId, message: "Compare them", offerSetId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "offer_set_not_found" });
  });
});

describe("GET /api/wording", () => {
  // Review fix (slice 6, spec S3): found by spec review; consent and disclosure copy lived in the UI.
  it("serves the compliance-owned wording the UI shows", async () => {
    const { app } = await setup();

    const res = await request(app).get("/api/wording").set(asSummit);

    expect(res.body).toEqual({ version: rules.version, fixedWording: rules.fixedWording, uiWording: rules.uiWording });
  });
});
