import { useRef, useState } from "react";
import { ComposerPanel } from "../composer/composer-panel";
import type { Workspace } from "../../../bridge/contracts";
import type { Agent } from "./task-types";

export function Followup({
  agent,
  enabled,
  workspace,
}: {
  agent: Agent;
  enabled: boolean;
  workspace?: Workspace;
}) {
  const [prompt, setPrompt] = useState("");
  const submission = useRef<{ requestId: string; prompt: string } | null>(null);
  const submit = async () => {
    if (!enabled || agent.sending || !prompt.trim() || agent.snapshot?.status !== "idle") return;
    if (submission.current?.prompt !== prompt)
      submission.current = { requestId: crypto.randomUUID(), prompt };
    if (await agent.send({ kind: "prompt", ...submission.current })) {
      setPrompt("");
      submission.current = null;
    }
  };
  return (
    <ComposerPanel
      value={prompt}
      onChange={setPrompt}
      onSubmit={() => void submit()}
      label="Follow-up prompt"
      sendLabel="Send"
      sendDisabled={
        !enabled || agent.sending || !prompt.trim() || agent.snapshot?.status !== "idle"
      }
      busy={agent.sending}
      running={enabled && agent.snapshot?.status === "running"}
      onStop={() => void agent.send({ kind: "cancel" })}
      branch={workspace?.repository.defaultBranch}
      repository={workspace?.repository.name.split("/").at(-1)}
    />
  );
}
