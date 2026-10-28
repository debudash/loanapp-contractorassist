// The assistant service's API. The portal authenticates contractors upstream and its
// gateway sets x-contractor-id from the session (PRD A-4); here a demo selector sets it.
import type { AssistResult, BallparkResult, OffersResult, Wording } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { error?: string; message?: string; min?: number; max?: number }) {
    super(body.error ?? "request_failed");
  }
}

export function apiFor(contractorId: string) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { "x-contractor-id": contractorId, "content-type": "application/json" },
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
    offers: (sessionId: string, amount: number, budget: number | undefined, applicantRef: string, consentVersion: string) =>
      call<OffersResult>("POST", "/offers", { sessionId, amount, budget, applicantRef, consent: { given: true, textVersion: consentVersion } }),
    /** offerSetId: the offers on screen, or null when none are shown. */
    assist: (sessionId: string, message: string, offerSetId: number | null) =>
      call<AssistResult>("POST", "/assist", { sessionId, message, offerSetId }),
    audit: (sessionId: string) => call<AuditTrail>("GET", `/sessions/${sessionId}/audit`),
  };
}

export type Api = ReturnType<typeof apiFor>;

/** The audit trail as the API returns it. Rows are kept loose: the view shows them as recorded. */
export interface AuditTrail {
  session: Record<string, unknown> | null;
  consents: Record<string, unknown>[];
  offerSets: (Record<string, unknown> & { offers: Record<string, unknown>[] })[];
  turns: Record<string, unknown>[];
  escalations: Record<string, unknown>[];
}
