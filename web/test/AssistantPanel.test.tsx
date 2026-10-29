import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../src/components/AssistantPanel";
import { InputsPanel } from "../src/components/InputsPanel";
import type { ChatMessage } from "../src/types";

const open = () => fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));

/** The panel with its open state held the way App holds it. */
function Panel(props: Omit<ComponentProps<typeof AssistantPanel>, "open" | "onOpenChange" | "starters"> & { starters?: string[] }) {
  const [isOpen, setOpen] = useState(false);
  return <AssistantPanel {...props} starters={props.starters ?? []} open={isOpen} onOpenChange={setOpen} />;
}

describe("AssistantPanel", () => {
  it("is closed by default and opens on request (FR-9)", () => {
    render(<Panel messages={[]} busy={false} onAsk={vi.fn()} />);

    expect(screen.queryByRole("textbox")).toBeNull();
    open();
    expect(screen.getByRole("textbox")).toBe(document.activeElement);
  });

  it("labels a standard explanation so the contractor knows it's fixed wording (F-2)", () => {
    const messages: ChatMessage[] = [{ question: "Which is best?", result: { kind: "answer", outcome: "standard_explanation", answer: "Lowest monthly: …", say: "" } }];
    render(<Panel messages={messages} busy={false} onAsk={vi.fn()} />);
    open();

    expect(screen.getByText("Standard explanation")).toBeDefined();
  });
});

describe("InputsPanel suggestion (FR-13)", () => {
  // Review fix (slice 6, spec S8): found by spec review; suggestions belonged in the inputs panel.
  it("shows the assistant's suggestion beside the inputs and changes them only on Apply", () => {
    const onApply = vi.fn();
    const onChange = vi.fn();
    render(
      <InputsPanel inputs={{ homeowner: "", amount: "30000", budget: "300", projectType: "roofing" }} onChange={onChange}
        suggestion={{ amount: 25_000, budget: 250 }} onApply={onApply} onDismiss={vi.fn()} noBudgetHint="Ask the homeowner." />,
    );

    expect(screen.getByText("Suggested: amount $25,000.00 · budget $250.00/mo")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ amount: 25_000, budget: 250 });
  });
});
