// The model boundary. assist() depends on this interface; anthropicModel.ts
// implements it with real API calls, and tests use a scripted fake.
import type { Draft } from "./guard.js";
import type { SuggestedInputs } from "./inputs.js";
import type { Card, Figures } from "./quote.js";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** The model couldn't give a usable answer: API error, refusal, truncation, timeout or cancellation (F-4). */
export class ModelUnavailable extends Error {}

/** What the contractor's message is. Credit and off-topic questions get fixed wording, not the model. */
export type Understanding =
  | { kind: "inputs"; inputs: SuggestedInputs }
  | { kind: "question" }
  | { kind: "credit_decision" }
  | { kind: "off_topic" };

export interface ExplainRequest {
  question: string;
  /** The cards on screen, and the only figures the model may use (by placeholder name). */
  cards: Card[];
  figures: Figures;
  /** Compliance-approved terms text for the products on screen (FR-10a). */
  termsTexts: string[];
  /** Earlier answers about the same offers, as placeholder drafts, oldest first (FR-16: at most four). */
  history: { question: string; answer: string }[];
  /** Why the previous draft was rejected, when this is the retry. */
  retryReasons: string[];
}

export interface MeaningVerdict {
  pass: boolean;
  quote: string | null;
  reason: string | null;
}

export type Step = "understand" | "explain" | "check";

/** Each call takes an abort signal so a question past its deadline stops spending (FR-16). */
export interface Model {
  readonly names: Record<Step, string>;
  understand(message: string, signal: AbortSignal): Promise<{ value: Understanding; usage: Usage }>;
  explain(request: ExplainRequest, signal: AbortSignal): Promise<{ value: Draft; usage: Usage }>;
  /** Second layer of G-2/G-3: catches rewordings the phrase list misses. */
  meaningCheck(draft: Draft, signal: AbortSignal): Promise<{ value: MeaningVerdict; usage: Usage }>;
}
