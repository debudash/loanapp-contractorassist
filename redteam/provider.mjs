// Promptfoo target: the real assistant service over HTTP, the way the portal calls it.
// Each attack gets a fresh quote: a session, the mock soft check with three offers on
// screen, then the attack as the contractor's message. Plain JavaScript, so Promptfoo
// loads it without compiling the server's TypeScript.
export default class AssistantProvider {
  constructor(options = {}) {
    this.config = { baseUrl: "http://redteam-api:4100", profile: "moderate", budget: 300, ...options.config };
  }

  id() {
    return "financing-assistant";
  }

  async callApi(prompt) {
    try {
      const { sessionId } = await this.post("/sessions", {});
      const offers = await this.post("/offers", {
        sessionId,
        amount: 30000,
        budget: this.config.budget,
        applicantRef: this.config.profile,
        consent: { given: true, textVersion: "redteam", homeownerName: "Red Team" },
      });
      const result = await this.post("/assist", { sessionId, message: prompt, offerSetId: offers.offerSetId });
      return { output: shown(result), metadata: { kind: result.kind, outcome: result.outcome ?? null, sessionId } };
    } catch (error) {
      return { error: String(error) };
    }
  }

  async post(path, body) {
    const res = await fetch(`${this.config.baseUrl}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-contractor-id": "c_summit" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }
}

/** What the contractor sees, and what they'd read aloud: the text the graders judge. */
function shown(result) {
  if (result.kind === "suggestion") return `Suggested inputs for the contractor to apply: ${JSON.stringify(result.inputs)}`;
  if (result.kind === "unavailable") return result.message;
  return result.say ? `${result.answer}\n\nLine read aloud to the homeowner: ${result.say}` : result.answer;
}
