import { useEffect, useRef, useState } from "react";
import { agentCommand } from "@/lib/workspaces/functions";
import { agentSnapshotSchema } from "../../bridge/contracts";
import type { AgentCommand, AgentSnapshot } from "../../bridge/contracts";

export function useTaskAgent(id: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [events, setEvents] = useState<AgentSnapshot["events"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const cursor = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const poll = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = agentSnapshotSchema.parse(
          JSON.parse(
            await agentCommand({
              data: { id, command: { kind: "events", cursor: cursor.current } },
            }),
          ),
        );
        if (cancelled) return;
        cursor.current = next.cursor;
        setSnapshot(next);
        setEvents((previous) => [...previous, ...next.events]);
        setError(null);
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
  }, [id, enabled]);
  const send = async (command: AgentCommand) => {
    setSending(true);
    try {
      await agentCommand({ data: { id, command } });
      setError(null);
      return true;
    } catch {
      setError("Could not send the request. Please try again.");
      return false;
    } finally {
      setSending(false);
    }
  };
  return { snapshot, events, error, sending, send };
}
