import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFor } from "../src/api";

const streamed = (...lines: object[]) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assist", () => {
  it("asks for streamed stages, reports each one, then returns the result", async () => {
    const fetch = streamed({ stage: "reading" }, { stage: "writing" }, { result: { kind: "unavailable", message: "Down." } });
    vi.stubGlobal("fetch", fetch);
    const stages: string[] = [];

    const result = await apiFor("c_summit").assist("s1", "Explain the promo", 1, (stage) => stages.push(stage));

    expect(stages).toEqual(["reading", "writing"]);
    expect(result).toEqual({ kind: "unavailable", message: "Down." });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: expect.objectContaining({ accept: "application/x-ndjson" }) });
  });

  it("fails when the stream ends with an error instead of a result", async () => {
    vi.stubGlobal("fetch", streamed({ stage: "reading" }, { error: "internal_error" }));

    await expect(apiFor("c_summit").assist("s1", "Explain the promo", 1, () => {})).rejects.toThrow("internal_error");
  });

  // MR 20 review: real streams arrive in chunks that can split a line, or a character, anywhere.
  it("reads lines and characters split across chunks, and a last line without a newline", async () => {
    const text = '{"stage":"reading"}\n{"stage":"writing"}\n{"result":{"kind":"unavailable","message":"Café closed."}}';
    const bytes = new TextEncoder().encode(text);
    const cut = [7, 25, bytes.length - 6]; // mid-line, and inside the two-byte "é"
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        [0, ...cut].forEach((from, i) => controller.enqueue(bytes.slice(from, cut[i] ?? bytes.length)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "application/x-ndjson" } })));
    const stages: string[] = [];

    const result = await apiFor("c_summit").assist("s1", "Explain the promo", 1, (stage) => stages.push(stage));

    expect(stages).toEqual(["reading", "writing"]);
    expect(result).toEqual({ kind: "unavailable", message: "Café closed." });
  });

  it("fails when the stream ends before a result", async () => {
    vi.stubGlobal("fetch", streamed({ stage: "reading" }));

    await expect(apiFor("c_summit").assist("s1", "Explain the promo", 1, () => {})).rejects.toThrow("answer_incomplete");
  });

  it("still accepts a plain JSON answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ kind: "unavailable", message: "Down." })));

    expect(await apiFor("c_summit").assist("s1", "Explain the promo", 1, () => {})).toEqual({ kind: "unavailable", message: "Down." });
  });
});
