// Stand-in for the Zapier webhook that opens a Jira Service Management ticket
// for compliance review (F-2). Logs the ticket reference only; the reason, which
// quotes the model's drafts, stays in the audit store.
export function escalateToComplianceStub(turnId: number, _reason: string): string {
  const ticketRef = `JSM-STUB-${turnId}`;
  console.warn(`[escalation] would open ${ticketRef} for turn ${turnId}`);
  return ticketRef;
}
