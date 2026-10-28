import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const wording = {
  version: "test",
  fixedWording: {},
  uiWording: {
    consent: "The homeowner has agreed to a soft credit check.",
    ballparkFinePrint: "Estimates from {aprMin}%–{aprMax}% APR.",
    promoCliff: "Pay off {payoff} within {months} months. If not, {cliff} of deferred interest is added.",
    noBudgetHint: "Ask her about a budget.",
  },
};
const card = {
  label: "lowest_total_and_monthly", offerId: "o1", kind: "fixed", monthlyPayment: 379.86, aprPercent: 8.99, termMonths: 120,
  numPayments: 120, amountFinanced: 30_000, financeCharge: 15_583.2, totalOfPayments: 45_583.2,
};

/** A fake of the assistant service's API, answering by path. */
function fakeApi() {
  return vi.fn(async (url: string) => {
    const body = url.endsWith("/wording") ? wording
      : url.endsWith("/sessions") ? { sessionId: "s1" }
      : url.endsWith("/ballpark") ? { ok: true, aprMin: 7.99, aprMax: 17.99, rows: [] }
      : url.endsWith("/offers") ? { noOffers: false, offerSetId: 1, cards: [card], allOffers: [card], totalCount: 1 }
      : { session: null, consents: [], offerSets: [], turns: [], escalations: [] };
    return new Response(JSON.stringify(body), { status: url.endsWith("/sessions") ? 201 : 200 });
  });
}

async function runSoftCheck() {
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Run soft check" }));
  await screen.findByText("$379.86");
}

beforeEach(() => {
  vi.stubGlobal("fetch", fakeApi());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  // Review fix (slice 6, spec S1): found by spec review; cards for old inputs stayed on screen.
  it("clears the offer cards when the amount or budget changes", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25000" } });

    await waitFor(() => expect(screen.queryByText("$379.86")).toBeNull());
  });

  // Review fix (slice 6, spec S2): found by spec review; one consent tick covered every later check.
  it("needs consent again for every soft check", async () => {
    render(<App />);
    await runSoftCheck();

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Run soft check" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
