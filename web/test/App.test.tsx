import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const wording = {
  version: "test",
  fixedWording: {},
  uiWording: {
    consent: "The homeowner has agreed to a soft credit check.",
    ballparkFinePrint: "Estimates from {aprMin}%–{aprMax}% APR.",
    promoCliff: "Pay off {payoff} within {months} months. If not, {cliff} of deferred interest is added.",
    noBudgetHint: "Ask the homeowner about a budget.",
    softCheckAsk: "Ask {homeowner} for permission to run a soft credit check.",
    ballparkNote: "Estimate only.",
    noOffersNotice: "No offers came back from this check.",
  },
};
const card = {
  label: "lowest_total_and_monthly", offerId: "o1", kind: "fixed", monthlyPayment: 379.86, aprPercent: 8.99, termMonths: 120,
  numPayments: 120, amountFinanced: 30_000, financeCharge: 15_583.2, totalOfPayments: 45_583.2,
};

/** A fake of the assistant service's API, answering by path. */
function fakeApi(offers: object = { noOffers: false, offerSetId: 1, cards: [card], allOffers: [card], totalCount: 1 }) {
  return vi.fn(async (url: string) => {
    const body = url.endsWith("/wording") ? wording
      : url.endsWith("/sessions") ? { sessionId: "s1" }
      : url.endsWith("/ballpark") ? { ok: true, aprMin: 7.99, aprMax: 17.99, rows: [] }
      : url.endsWith("/offers") ? offers
      : { session: null, consents: [], offerSets: [], turns: [], escalations: [] };
    return new Response(JSON.stringify(body), { status: url.endsWith("/sessions") ? 201 : 200 });
  });
}

async function runSoftCheck() {
  fireEvent.change(screen.getByLabelText("Homeowner name"), { target: { value: "Maria Lopez" } });
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

  // Slice 9: found in the UI walkthrough; nothing said who the quote was for.
  it("needs the homeowner's name for a soft check, and sends it with the consent", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("checkbox"));
    const run = screen.getByRole("button", { name: "Run soft check" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Homeowner name"), { target: { value: "Maria Lopez" } });
    expect(screen.getByText("Ask Maria Lopez for permission to run a soft credit check.")).toBeDefined();
    fireEvent.click(run);

    await screen.findByText("$379.86");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/offers"))!;
    expect(JSON.parse(String(call[1]!.body)).consent).toMatchObject({ given: true, homeownerName: "Maria Lopez" });
  });

  // ISS-11: found in the owner's walkthrough; after switching the test credit profile, the last
  // check's result (here the no-offers notice) stayed on screen as if it belonged to the new profile.
  it("ISS-11: clears the last soft check's result when the test credit profile changes", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.change(screen.getByLabelText("Credit mock profile"), { target: { value: "no_offers" } });

    await waitFor(() => expect(screen.queryByText("$379.86")).toBeNull());
  });

  // Found in the owner's walkthrough: the profile came after the button, so the order to follow wasn't clear.
  it("puts the steps of a soft check in the order they're done: profile, consent, run", async () => {
    render(<App />);
    const profile = await screen.findByLabelText("Credit mock profile");
    const consent = screen.getByRole("checkbox");
    const run = screen.getByRole("button", { name: "Run soft check" });

    expect(profile.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(consent.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Found in the owner's walkthrough: the no-offers notice sat between steps 3 and 4, while step 4
  // still said to run the soft check.
  it("shows a no-offers result in step 4, where offers would be", async () => {
    vi.stubGlobal("fetch", fakeApi({ noOffers: true, offerSetId: 1, message: "No offers came back from this check.", cards: [], allOffers: [], totalCount: 0 }));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Homeowner name"), { target: { value: "John Doe" } });
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Run soft check" }));

    const step4 = await screen.findByRole("region", { name: "Offers for John Doe" });
    await waitFor(() => expect(within(step4).getByText("No offers came back from this check.")).toBeDefined());
    expect(within(step4).queryByText("Run the soft check to see real offers.")).toBeNull();
    await waitFor(() => expect(step4.getAttribute("aria-current")).toBe("step")); // once the ballpark has loaded
    expect(screen.getByText(/Next: no offers came back from this check\. See step 4\./)).toBeDefined();
  });

  // MR 9 spec review: offers stayed on screen under a new name, though the consent was another homeowner's.
  it("clears the offer cards when the homeowner's name changes", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.change(screen.getByLabelText("Homeowner name"), { target: { value: "Bob Smith" } });

    await waitFor(() => expect(screen.queryByText("$379.86")).toBeNull());
  });

  // MR 9 spec review: step 3 was never marked current while the contractor was on it.
  it("marks the soft check as the current step once the ballpark shows", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Real offers" }).getAttribute("aria-current")).toBe("step"));
    expect(screen.getByRole("region", { name: "Ballpark estimates" }).getAttribute("aria-current")).toBeNull();
  });

  // Slice 9: found in the UI walkthrough; nothing said what to do next.
  it("says what to do next at each step", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Homeowner name"), { target: { value: "Maria Lopez" } });
    expect(await screen.findByText(/Next: share the ballpark estimates with Maria Lopez/)).toBeDefined();

    await runSoftCheck();

    expect(screen.getByText(/Next: walk Maria Lopez through the offers/)).toBeDefined();
  });

  // Slice 9: found in the UI walkthrough; the compliance view sat under the contractor's cards.
  it("opens the compliance view as its own page, and goes back to the same quote", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.click(screen.getByRole("button", { name: "Compliance view" }));
    expect(await screen.findByRole("heading", { name: "Compliance view" })).toBeDefined();
    expect(screen.queryByText("$379.86")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to the quote" }));
    expect(screen.getByText("$379.86")).toBeDefined();
  });

  // Slice 9: found in the UI walkthrough; there was no way to start over for the next homeowner.
  it("starts a new quote with a new session and nothing carried over", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.click(screen.getByRole("button", { name: "Start new quote" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/sessions"))).toHaveLength(2));
    expect(screen.queryByText("$379.86")).toBeNull();
    expect((screen.getByLabelText("Homeowner name") as HTMLInputElement).value).toBe("");
  });

  // Slice 9: found in the UI walkthrough; the assistant opened to an empty box.
  it("offers starter questions that match the screen, and asks one on a tap", async () => {
    render(<App />);
    await runSoftCheck();

    fireEvent.click(screen.getByRole("button", { name: "Need help explaining? Ask the assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "What does the finance charge mean?" }));

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/assist"));
      expect(JSON.parse(String(call![1]!.body)).message).toBe("What does the finance charge mean?");
    });
  });
});
