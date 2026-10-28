import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import rules from "../src/compliance-rules.json" with { type: "json" };
import { AuditStore } from "../src/audit.js";
import { mockCatalog } from "../src/mocks/catalog.js";
import { MockDecisionEngine } from "../src/mocks/decisionEngine.js";
import { FakeModel } from "./fakeModel.js";

function setup() {
  const audit = new AuditStore(":memory:");
  const engine = new MockDecisionEngine();
  const softCheck = vi.spyOn(engine, "softCheck");
  const app = createApp({ catalog: mockCatalog, engine, audit, model: new FakeModel(), escalate: () => "JSM-STUB" });
  return { app, softCheck };
}

const asSummit = { "x-contractor-id": "c_summit" };
const asValley = { "x-contractor-id": "c_valley" };
const consent = { given: true, textVersion: "soft-check-v1" };

async function openSession(app: ReturnType<typeof setup>["app"], as = asSummit): Promise<string> {
  const res = await request(app).post("/api/sessions").set(as);
  expect(res.status).toBe(201);
  return res.body.sessionId;
}

async function trailOf(app: ReturnType<typeof setup>["app"], sessionId: string) {
  const res = await request(app).get(`/api/sessions/${sessionId}/audit`).set(asSummit);
  expect(res.status).toBe(200);
  return res.body;
}

describe("POST /api/offers", () => {
  it("refuses a soft check without the homeowner's consent, and calls and stores nothing", async () => {
    const { app, softCheck } = setup();
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/offers").set(asSummit).send({ sessionId, amount: 30_000, applicantRef: "moderate" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "consent_required" });
    expect(softCheck).not.toHaveBeenCalled();
    expect((await trailOf(app, sessionId)).consents).toEqual([]);
  });

  it("records consent, then shows three cards from the engine's offers", async () => {
    const { app } = setup();
    const sessionId = await openSession(app);

    const res = await request(app)
      .post("/api/offers")
      .set(asSummit)
      .send({ sessionId, amount: 30_000, budget: 300, applicantRef: "moderate", consent });

    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(5);
    expect(res.body.cards.map((c: { label: string; monthlyPayment: number }) => [c.label, c.monthlyPayment])).toEqual([
      ["lowest_total", 379.86],
      ["lowest_monthly", 289.31],
      ["promo", 440.4],
    ]);

    const trail = await trailOf(app, sessionId);
    expect(trail.consents).toHaveLength(1);
    expect(trail.consents[0]).toMatchObject({ kind: "soft_check", consentTextVersion: "soft-check-v1" });
    expect(trail.offerSets).toHaveLength(1);
    expect(trail.offerSets[0]).toMatchObject({
      consentId: trail.consents[0].id,
      amount: 30_000,
      budget: 300,
      offerCount: 5,
      catalogVersion: mockCatalog.version,
      quoteVersion: expect.any(String),
    });
    expect(trail.offerSets[0].offers).toHaveLength(5);
  });

  // Review fix (slice 3, spec S7): found by spec review; the homeowner's budget was sent to the credit engine.
  it("sends the credit engine only the applicant and the amount, never the budget", async () => {
    const { app, softCheck } = setup();
    const sessionId = await openSession(app);

    await request(app).post("/api/offers").set(asSummit).send({ sessionId, amount: 30_000, budget: 300, applicantRef: "moderate", consent });

    expect(softCheck).toHaveBeenCalledWith({ applicantRef: "moderate", amount: 30_000 });
  });

  it("says the lender will send a notice when there are no offers, and doesn't say why", async () => {
    const { app } = setup();
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/offers").set(asSummit).send({ sessionId, amount: 30_000, applicantRef: "no_offers", consent });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      noOffers: true,
      message: rules.fixedWording.noOffers,
      cards: [],
      allOffers: [],
      totalCount: 0,
    });
  });

  // Review fix (slice 3, spec S1): found by spec review; a missing applicant showed a false decline notice.
  it("asks for the applicant instead of reporting no offers when none is named", async () => {
    const { app, softCheck } = setup();
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/offers").set(asSummit).send({ sessionId, amount: 30_000, consent });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "applicant_required" });
    expect(softCheck).not.toHaveBeenCalled();
  });

  // Review fix (slice 3, spec S2): found by spec review; an engine error left no record of what happened.
  it("reports the soft check as unavailable when the engine fails, and stores no offer set", async () => {
    const { app, softCheck } = setup();
    softCheck.mockRejectedValueOnce(new Error("engine down"));
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/offers").set(asSummit).send({ sessionId, amount: 30_000, applicantRef: "moderate", consent });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "soft_check_unavailable" });
    const trail = await trailOf(app, sessionId);
    expect(trail.consents).toHaveLength(1);
    expect(trail.offerSets).toEqual([]);
  });

  // Review fix (slice 3, spec S4): found by spec review; bad numbers became NaN.
  it.each([
    [{ amount: 150_000 }, { error: "amount_out_of_range", min: 5_000, max: 100_000 }],
    [{ amount: 30_000, budget: "abc" }, { error: "invalid_budget" }],
  ])("rejects bad numbers with a reason: %o", async (numbers, error) => {
    const { app } = setup();
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/offers").set(asSummit).send({ sessionId, applicantRef: "moderate", consent, ...numbers });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(error);
  });
});

describe("sessions and identity", () => {
  it("rejects a request with no contractor identity", async () => {
    const { app } = setup();

    const res = await request(app).post("/api/sessions");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "contractor_required" });
  });

  // Review fix (slice 3, spec S3): found by spec review; reads created sessions and IDs could be claimed.
  it("keeps one contractor out of another's session, and never creates a session on read", async () => {
    const { app } = setup();
    const summitSession = await openSession(app);

    expect((await request(app).get(`/api/sessions/${summitSession}/audit`).set(asValley)).status).toBe(403);
    expect((await request(app).post("/api/ballpark").set(asValley).send({ sessionId: summitSession, amount: 30_000 })).status).toBe(403);
    expect((await request(app).get("/api/sessions/no-such-session/audit").set(asSummit)).status).toBe(404);
    expect((await request(app).post("/api/ballpark").set(asSummit).send({ amount: 30_000 })).status).toBe(400);
  });
});

describe("POST /api/ballpark", () => {
  it("quotes from the contractor's enrolled fixed-rate products", async () => {
    const { app } = setup();
    const sessionId = await openSession(app);

    const res = await request(app).post("/api/ballpark").set(asSummit).send({ sessionId, amount: 30_000, budget: 300 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows.find((r: { termMonths: number }) => r.termMonths === 120)).toEqual({
      termMonths: 120,
      monthlyLow: 363.82,
      monthlyHigh: 540.36,
      fit: "does_not_fit",
    });
    expect((await trailOf(app, sessionId)).session).toMatchObject({ id: sessionId, contractorId: "c_summit" });
  });

  it("only uses the products this contractor is enrolled in", async () => {
    const { app } = setup();
    const sessionId = await openSession(app, asValley);

    const res = await request(app).post("/api/ballpark").set(asValley).send({ sessionId, amount: 30_000 });

    expect(res.body.rows.map((r: { termMonths: number }) => r.termMonths)).toEqual([60, 120]);
  });
});
