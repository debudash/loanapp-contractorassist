// The assistant service's API. The portal authenticates contractors upstream and its
// gateway sets x-contractor-id from the session (PRD A-4); here a demo selector sets it.
import type { AssistResult, BallparkResult, OffersResult, Stage, Wording } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { error?: string; message?: string; min?: number; max?: number }) {
    super(body.error ?? "request_failed");
  }
}

export function apiFor(contractorId: string) {
  const headers = { "x-contractor-id": contractorId, "content-type": "application/json" };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json);
    return json as T;
  };

  return {
    wording: () => call<Wording>("GET", "/wording"),
    createSession: () => call<{ sessionId: string }>("POST", "/sessions"),
    ballpark: (sessionId: string, amount: number, budget?: number) =>
      call<BallparkResult>("POST", "/ballpark", { sessionId, amount, budget }),
    /** The consent version is the compliance rules version the consent wording came from (FR-4). */
    /** The homeowner's name is kept with the consent for the audit trail; the model never gets it. */
    offers: (sessionId: string, amount: number, budget: number | undefined, applicantRef: string, consentVersion: string, homeownerName: string) =>
      call<OffersResult>("POST", "/offers", {
        sessionId, amount, budget, applicantRef, consent: { given: true, textVersion: consentVersion, homeownerName },
      }),
    /**
     * offerSetId: the offers on screen, or null when none are shown. The answer comes as JSON
     * lines: one per stage as it starts (reported to onStage), then the result.
     */
    assist: async (sessionId: string, message: string, offerSetId: number | null, onStage: (stage: Stage) => void) => {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { ...headers, accept: "application/x-ndjson" },
        body: JSON.stringify({ sessionId, message, offerSetId }),
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
      if (!res.headers.get("content-type")?.includes("ndjson") || !res.body) return (await res.json()) as AssistResult;
      return readStages(res.body, onStage);
    },
    audit: (sessionId: string) => call<AuditTrail>("GET", `/sessions/${sessionId}/audit`),
  };
}

export type Api = ReturnType<typeof apiFor>;

/**
 * Reads JSON lines until the result: stages go to onStage; an error line fails the request.
 * Chunks can split a line or a character anywhere; a last line may lack its newline.
 */
async function readStages(body: ReadableStream<Uint8Array>, onStage: (stage: Stage) => void): Promise<AssistResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = done ? "" : lines.pop()!;
      for (const line of lines.filter((l) => l.trim())) {
        const message = JSON.parse(line) as { stage?: Stage; result?: AssistResult; error?: string };
        if (message.result) return message.result;
        if (message.error) throw new ApiError(500, { error: message.error });
        if (message.stage) onStage(message.stage);
      }
      if (done) throw new ApiError(500, { error: "answer_incomplete" });
    }
  } finally {
    void reader.cancel().catch(() => {}); // nothing more is needed once the result or an error arrives
  }
}

/** The audit trail as the API returns it. Rows are kept loose: the view shows them as recorded. */
export interface AuditTrail {
  session: Record<string, unknown> | null;
  consents: Record<string, unknown>[];
  offerSets: (Record<string, unknown> & { offers: Record<string, unknown>[] })[];
  turns: Record<string, unknown>[];
  escalations: Record<string, unknown>[];
}
