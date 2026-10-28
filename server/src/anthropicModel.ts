// The real model adapter: three small calls, each returning JSON checked against
// a schema (structured outputs). Haiku reads requests and runs the meaning check;
// Sonnet writes explanations. Every failure becomes ModelUnavailable.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Draft } from "./guard.js";
import { type ExplainRequest, type MeaningVerdict, type Model, ModelUnavailable, type Understanding, type Usage } from "./model.js";
import { EXPLAIN_SYSTEM, explainPrompt, MEANING_CHECK_SYSTEM, UNDERSTAND_SYSTEM } from "./prompts.js";

const UnderstandingSchema = z.object({
  kind: z.enum(["inputs", "question", "credit_decision", "off_topic"]),
  amount: z.number().nullable(),
  budget: z.number().nullable(),
  projectType: z.enum(["roofing", "hvac", "solar", "windows", "other"]).nullable(),
});
const DraftSchema = z.object({ answer: z.string(), say: z.string() });
const VerdictSchema = z.object({ pass: z.boolean(), quote: z.string().nullable(), reason: z.string().nullable() });

export class AnthropicModel implements Model {
  readonly names = { understand: "claude-haiku-5-5", explain: "claude-sonnet-5-5", check: "claude-haiku-5-5" };
  private client?: Anthropic;

  async understand(message: string, signal: AbortSignal): Promise<{ value: Understanding; usage: Usage }> {
    const { value, usage } = await this.call(this.names.understand, UNDERSTAND_SYSTEM, message, UnderstandingSchema, 2_048, signal);
    if (value.kind !== "inputs") return { value: { kind: value.kind }, usage };
    const inputs = {
      ...(value.amount !== null && { amount: value.amount }),
      ...(value.budget !== null && { budget: value.budget }),
      ...(value.projectType !== null && { projectType: value.projectType }),
    };
    return { value: { kind: "inputs", inputs }, usage };
  }

  explain(request: ExplainRequest, signal: AbortSignal): Promise<{ value: Draft; usage: Usage }> {
    return this.call(this.names.explain, EXPLAIN_SYSTEM, explainPrompt(request), DraftSchema, 2_000, signal);
  }

  meaningCheck(draft: Draft, signal: AbortSignal): Promise<{ value: MeaningVerdict; usage: Usage }> {
    const content = `answer: ${draft.answer}\nsay: ${draft.say}`;
    return this.call(this.names.check, MEANING_CHECK_SYSTEM, content, VerdictSchema, 2_048, signal);
  }

  /**
   * The client, created on first use so the service (and the cards) run even with no API key set.
   * No SDK retries: assist() owns the deadline and cancels through the abort signal, so nothing
   * keeps running (and billing) after a question has given up. Called inside call()'s try.
   */
  private anthropic(): Anthropic {
    this.client ??= new Anthropic({ maxRetries: 0 });
    return this.client;
  }

  /** One structured call. Output caps (which include the model's thinking) bound the cost of each call (FR-16). */
  private async call<T>(model: string, system: string, content: string, schema: z.ZodType<T>, maxTokens: number, signal: AbortSignal) {
    let response;
    try {
      response = await this.anthropic().messages.parse(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content }],
          // Low effort: short, structured tasks where speed matters more than depth.
          output_config: { format: zodOutputFormat(schema), effort: "low" },
        },
        { signal },
      );
    } catch (error) {
      throw new ModelUnavailable(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Refusal, truncation (max_tokens) or output that doesn't match the schema.
    if (response.stop_reason !== "end_turn" || !response.parsed_output) {
      throw new ModelUnavailable(`${model}: no usable output (stop reason ${response.stop_reason})`);
    }
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    // parse() has checked the output against the schema, so the cast is safe.
    return { value: response.parsed_output as T, usage };
  }
}
