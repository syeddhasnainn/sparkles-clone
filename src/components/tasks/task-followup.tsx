import { useRef, useState } from "react";
import type { Agent } from "./task-types";

export function Followup({ agent, enabled }: { agent: Agent; enabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const submission = useRef<{ requestId: string; prompt: string } | null>(null);
  const submit = async () => {
    if (submission.current?.prompt !== prompt)
      submission.current = { requestId: crypto.randomUUID(), prompt };
    if (await agent.send({ kind: "prompt", ...submission.current })) {
      setPrompt("");
      submission.current = null;
    }
  };
  return (
    <form
      className="task-followup"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Follow-up prompt"
        placeholder="Ask OpenCode to continue…"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={!enabled}
      />
      <div>
        {agent.snapshot?.status === "running" ? (
          <button
            disabled={!enabled || agent.sending}
            type="button"
            onClick={() => void agent.send({ kind: "cancel" })}
          >
            Stop response
          </button>
        ) : (
          <button
            type="submit"
            disabled={
              !enabled || agent.sending || !prompt.trim() || agent.snapshot?.status !== "idle"
            }
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
}
