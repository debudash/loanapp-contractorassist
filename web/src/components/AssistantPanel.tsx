import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  onAsk: (message: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prompts that fit what's on screen, asked with one tap. */
  starters: string[];
}

const OUTCOME_BADGES = { standard_explanation: "Standard explanation", redirected: "Fixed wording" } as const;

/** The assistant, closed by default; the cards never depend on it (FR-9). A chat: the contractor's messages on the right, answers on the left. */
export function AssistantPanel({ messages, busy, onAsk, open, onOpenChange, starters }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLLIElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  // Focus follows the panel: the input when it opens, the open button when the contractor closes it.
  useEffect(() => {
    if (open) input.current?.focus();
    else if (closing.current) reopen.current?.focus();
    closing.current = false;
  }, [open]);

  // Show the newest exchange from its question, so a long answer doesn't push the question out of
  // view. Only the chat scrolls; the page stays where the contractor left it.
  useEffect(() => {
    if (scroller.current && latest.current) scroller.current.scrollTop = latest.current.offsetTop - 16;
  }, [messages.length, busy, open]);

  if (!open) {
    return (
      <aside className="assistant closed" aria-label="Assistant">
        <strong>Assistant</strong>
        <p className="fine">Explains the offers in plain words, with a line to read aloud.</p>
        <button type="button" ref={reopen} onClick={() => onOpenChange(true)}>
          Ask the assistant
        </button>
      </aside>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    onAsk(draft.trim());
    setDraft("");
  };
  const prompts = starters.filter((s) => !messages.some((m) => m.question === s));

  return (
    <aside className="assistant open" aria-label="Assistant">
      <header>
        <strong>Assistant</strong>
        <button
          type="button"
          className="link"
          onClick={() => {
            closing.current = true;
            onOpenChange(false);
          }}
        >
          Close
        </button>
      </header>
      <div className="chat-scroll" ref={scroller}>
        {messages.length === 0 && !busy && (
          <p className="chat-empty">Ask about the offers on screen, or type new numbers the way the homeowner says them.</p>
        )}
        <ol className="chat" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} ref={i === messages.length - 1 && !busy ? latest : undefined}>
              <p className="bubble mine">{m.question}</p>
              <div className="bubble theirs">
                <Reply result={m.result} />
              </div>
            </li>
          ))}
          {busy && (
            <li ref={latest}>
              <p className="bubble theirs muted">Thinking…</p>
            </li>
          )}
        </ol>
      </div>
      {prompts.length > 0 && (
        <div className="prompts" role="group" aria-label="Suggested prompts">
          {prompts.map((q) => (
            <button
              key={q}
              type="button"
              className="prompt"
              disabled={busy}
              onClick={() => {
                onAsk(q);
                input.current?.focus();
              }}
            >
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
          placeholder="Ask, or type new numbers…"
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
      <>
        <p>I've put the new numbers in the inputs panel. Tap Apply there to use them.</p>
        {result.dropped.length > 0 && <p className="muted">Please enter the {result.dropped.join(" and ")} yourself.</p>}
      </>
    );
  }
  return (
    <>
      {result.outcome !== "answered" && <span className="badge">{OUTCOME_BADGES[result.outcome]}</span>}
      <p>{result.answer}</p>
      {result.say && <p className="say">Say it like this: “{result.say}”</p>}
    </>
  );
}
