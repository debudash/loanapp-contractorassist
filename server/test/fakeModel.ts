import type { Draft } from "../src/guard.js";
import { type ExplainRequest, type MeaningCheckRequest, type MeaningVerdict, type Model, ModelUnavailable, type Understanding } from "../src/model.js";

// Every fake call reports the same usage, so a turn's tokens are 100 in and 20 out per call.
const usage = { inputTokens: 100, outputTokens: 20 };

type Step = "understand" | "explain" | "meaningCheck";

/**
 * The model, faked at the boundary: scripted answers, and a record of what it was asked.
 * Running out of script throws, so an under-scripted test fails instead of passing by accident.
 */
export class FakeModel implements Model {
  readonly names = { understand: "fake-haiku", explain: "fake-sonnet", check: "fake-haiku" };
  understandings: Understanding[] = [];
  drafts: Draft[] = [];
  verdicts: MeaningVerdict[] = [];
  explainRequests: ExplainRequest[] = [];
  understandCalls: string[] = [];
  checkRequests: MeaningCheckRequest[] = [];
  /** Make this step fail as the real adapter does when the API errors. */
  failOn?: Step;
  /** Make this step never answer, so only the deadline ends it. */
  hangOn?: Step;

  understand(message: string, signal: AbortSignal) {
    this.understandCalls.push(message);
    return this.next("understand", this.understandings, signal);
  }
  explain(request: ExplainRequest, signal: AbortSignal) {
    this.explainRequests.push(request);
    return this.next("explain", this.drafts, signal);
  }
  meaningCheck(request: MeaningCheckRequest, signal: AbortSignal) {
    this.checkRequests.push(request);
    return this.next("meaningCheck", this.verdicts, signal);
  }

  private async next<T>(step: Step, script: T[], signal: AbortSignal): Promise<{ value: T; usage: typeof usage }> {
    if (this.failOn === step) throw new ModelUnavailable(`fake ${step} failure`);
    if (this.hangOn === step) {
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ModelUnavailable("aborted"))));
    }
    const value = script.shift();
    if (value === undefined) throw new Error(`FakeModel: nothing scripted for ${step}`);
    return { value, usage };
  }
}

export const PASS: MeaningVerdict = { pass: true, quote: null, reason: null };
