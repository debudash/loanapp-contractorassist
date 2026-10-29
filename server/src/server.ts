// Entry point: real model, mock financial services, SQLite audit store.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AnthropicModel } from "./anthropicModel.js";
import { createApp, limitsFromEnv } from "./app.js";
import { AuditStore } from "./audit.js";
import { escalateToComplianceStub } from "./escalation.js";
import { mockCatalog } from "./mocks/catalog.js";
import { MockDecisionEngine } from "./mocks/decisionEngine.js";

const dbPath = process.env.DB_PATH ?? "data/assistant.db";
const port = Number(process.env.PORT ?? 4100);

mkdirSync(dirname(dbPath), { recursive: true });
const app = createApp({
  catalog: mockCatalog,
  engine: new MockDecisionEngine(),
  audit: new AuditStore(dbPath),
  model: new AnthropicModel(),
  escalate: escalateToComplianceStub,
  limits: limitsFromEnv(process.env),
});

app.listen(port, () => console.log(`Assistant API on :${port}`));
