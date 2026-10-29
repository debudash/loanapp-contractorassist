import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuditStore } from "../src/audit.js";
import { mockCatalog } from "../src/mocks/catalog.js";
import { MockDecisionEngine } from "../src/mocks/decisionEngine.js";
import { FakeModel } from "./fakeModel.js";

// Public deployment: one machine serves the built web app as well as the API.
function appServing(staticDir?: string) {
  return createApp({
    catalog: mockCatalog, engine: new MockDecisionEngine(), audit: new AuditStore(":memory:"),
    model: new FakeModel(), escalate: () => "JSM-STUB", staticDir,
  });
}

function builtWeb() {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(dir, "app.js"), "console.log(1)");
  return dir;
}

describe("serving the web app", () => {
  it("serves the built files, and index.html for any other page path", async () => {
    const app = appServing(builtWeb());

    expect((await request(app).get("/")).text).toContain("<title>app</title>");
    expect((await request(app).get("/app.js")).text).toBe("console.log(1)");
    expect((await request(app).get("/compliance")).text).toContain("<title>app</title>");
  });

  it("leaves the API and the health check alone", async () => {
    const app = appServing(builtWeb());

    expect((await request(app).get("/api/unknown")).status).toBe(401); // contractor_required, not index.html
    expect((await request(app).get("/api").set("x-contractor-id", "c_summit")).text).not.toContain("<title>app</title>");
    expect((await request(app).get("/health")).body).toEqual({ ok: true });
  });

  it("serves no pages when no directory is given, as in local Docker behind nginx", async () => {
    expect((await request(appServing()).get("/")).status).toBe(404);
  });
});
