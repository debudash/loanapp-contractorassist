import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  onAsk: (message: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Questions that fit what's on screen, asked with one tap. */
  starters: string[];
}

const OUTCOME_BADGES = { standard_explanation: "Standard explanation", redirected: "Fixed wording" } as const;

/** The assistant, closed by default; the cards never depend on it (FR-9). */
export function AssistantPanel({ messages, busy, onAsk, open, onOpenChange, starters }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="assistant-toggle" onClick={() => onOpenChange(true)}>
        Ask the assistant
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    onAsk(draft.trim());
    setDraft("");
  };

  return (
    <aside className="assistant" aria-label="Assistant">
      <header>
        <strong>Assistant</strong>
        <button type="button" className="link" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </header>
      <ol className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i}>
            <p className="q">{m.question}</p>
            <Reply result={m.result} />
          </li>
        ))}
        {busy && <li className="muted">Thinking…</li>}
      </ol>
      {starters.length > 0 && (
        <div className="starters" role="group" aria-label="Starter questions">
          {starters.map((q) => (
            <button key={q} type="button" className="starter" disabled={busy} onClick={() => onAsk(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit}>
        <input
          ref={input}
          type="text"
          aria-label="Ask about the offers, or type new numbers"
          placeholder={`"$30K roof, they can do $300 a month" or "Explain the promo"`}
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </aside>
  );
}

function Reply({ result }: { result: ChatMessage["result"] }) {
  if (result.kind === "unavailable") return <p className="muted">{result.message}</p>;
  if (result.kind === "suggestion") {
    return (
      <div>
        <p>I've put the new numbers in the inputs panel. Tap Apply there to use them.</p>
        {result.dropped.length > 0 && <p className="muted">Please enter the {result.dropped.join(" and ")} yourself.</p>}
      </div>
    );
  }
  return (
    <div className="answer">
      {result.outcome !== "answered" && <span className="badge">{OUTCOME_BADGES[result.outcome]}</span>}
      <p>{result.answer}</p>
      {result.say && <p className="say">Say it like this: “{result.say}”</p>}
    </div>
  );
}
