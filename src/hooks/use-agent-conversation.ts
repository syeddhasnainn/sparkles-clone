import { useEffect, useRef, useState } from "react";
import { agentSnapshotSchema } from "../../bridge/contracts";
import type { AgentCommand, AgentSnapshot } from "../../bridge/contracts";

export function useAgentConversation(
  id: string,
  enabled: boolean,
  execute: (input: { data: { id: string; command: AgentCommand } }) => Promise<string>,
  initialSnapshot: AgentSnapshot | null = null,
) {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(initialSnapshot);
  const [events, setEvents] = useState<AgentSnapshot["events"]>(initialSnapshot?.events ?? []);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<Extract<
    AgentCommand,
    { kind: "prompt" }
  > | null>(null);
  const cursor = useRef(initialSnapshot?.cursor ?? 0);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        let through: number | undefined;
        do {
          const previousCursor = cursor.current;
          const next = agentSnapshotSchema.parse(
            JSON.parse(
              await execute({
                data: { id, command: { kind: "events", cursor: cursor.current } },
              }),
            ),
          );
          if (cancelled) return;
          cursor.current = next.cursor;
          setSnapshot((current) => ((current?.head ?? 0) > (next.head ?? 0) ? current : next));
          if (next.events.length) setEvents((previous) => [...previous, ...next.events]);
          setError(null);
          through ??= next.head ?? next.cursor;
          if (next.cursor >= through || next.cursor <= previousCursor) break;
        } while (!cancelled);
      } catch {
        if (!cancelled) setError("Could not load the saved conversation. Retrying…");
      } finally {
        loading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), enabled ? 1000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, enabled, execute]);
  const send = async (command: AgentCommand) => {
    setSending(true);
    if (command.kind === "prompt") setPendingPrompt(command);
    try {
      const next = agentSnapshotSchema.parse(JSON.parse(await execute({ data: { id, command } })));
      setSnapshot((current) => ((current?.head ?? 0) > (next.head ?? 0) ? current : next));
      setError(null);
      return true;
    } catch {
      if (command.kind === "prompt") setPendingPrompt(null);
      setError("Could not send the request. Please try again.");
      return false;
    } finally {
      setSending(false);
    }
  };
  const unconfirmed =
    pendingPrompt &&
    !events.some(
      (event) => event.type === "user" && event.data.requestId === pendingPrompt.requestId,
    );
  const visibleEvents = unconfirmed
    ? [
        ...events,
        {
          id: -1,
          type: "user",
          data: { text: pendingPrompt.prompt, requestId: pendingPrompt.requestId },
        },
      ]
    : events;
  return {
    snapshot,
    events: visibleEvents,
    error,
    sending,
    send,
    awaitingPrompt:
      Boolean(unconfirmed) &&
      !["stopped", "interrupted", "failed"].includes(snapshot?.status ?? "starting"),
  };
}
