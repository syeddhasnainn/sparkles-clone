import { useEffect, useRef, useState } from "react";
import { useChatGPTConnection } from "../../hooks/use-chatgpt-connection";
import {
  startChatGPTConnection,
  pollChatGPTConnection,
  cancelChatGPTConnection,
  disconnectChatGPTConnection,
} from "../../lib/chatgpt/functions";

type Challenge = Awaited<ReturnType<typeof startChatGPTConnection>>;

export function useChatGPTSettings() {
  const { connection, error: loadError, reload } = useChatGPTConnection();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  useEffect(() => {
    if (!challenge) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= challenge.expiresAt) {
        setError("This code expired. Connect again to get a new code.");
        setChallenge(null);
        return;
      }
      try {
        const result = await pollChatGPTConnection({ data: { id: challenge.id } });
        if (cancelled) return;
        if (result.status === "connected") {
          active.current = null;
          setChallenge(null);
          await reload();
        } else timer = setTimeout(() => void poll(), challenge.intervalMs);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "ChatGPT sign-in failed. Try again.");
          setChallenge(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), challenge.intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [challenge, reload]);
  useEffect(
    () => () => {
      if (active.current)
        void cancelChatGPTConnection({ data: { id: active.current } }).catch(() => undefined);
    },
    [],
  );
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await startChatGPTConnection();
      active.current = next.id;
      setChallenge(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect ChatGPT.");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectChatGPTConnection();
      setChallenge(null);
      active.current = null;
      await reload();
    } catch {
      setError("Could not disconnect ChatGPT. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (!challenge) return;
    active.current = null;
    setChallenge(null);
    void cancelChatGPTConnection({ data: { id: challenge.id } }).catch(() =>
      setError("Could not cancel sign-in."),
    );
  };
  return { connection, loadError, challenge, busy, error, start, disconnect, cancel };
}
