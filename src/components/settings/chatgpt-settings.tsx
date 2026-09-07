import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { useChatGPTConnection } from "../../hooks/use-chatgpt-connection";
import {
  startChatGPTConnection,
  pollChatGPTConnection,
  cancelChatGPTConnection,
  disconnectChatGPTConnection,
} from "../../lib/chatgpt/functions";

type Challenge = Awaited<ReturnType<typeof startChatGPTConnection>>;

export function ChatGPTSettings() {
  const { connection, error: loadError, reload } = useChatGPTConnection();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  const account = connection?.account;
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
  return (
    <section
      className="rounded-lg border border-border bg-card p-5 text-card-foreground"
      aria-labelledby="chatgpt-heading"
    >
      <h2 id="chatgpt-heading" className="text-sm font-medium">
        ChatGPT
      </h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Connect once to use your ChatGPT subscription with OpenCode and Codex. Both share your
        account’s allowance.
      </p>
      {!connection && !loadError && (
        <p className="mt-4 text-sm" role="status">
          Loading connection…
        </p>
      )}
      {connection && !connection.configured && (
        <p className="mt-4 text-sm">ChatGPT connections aren’t available yet.</p>
      )}
      {account && (
        <div className="mt-4 text-[13px]">
          <p>
            {account.email || "ChatGPT account"}
            {account.plan ? ` · ${account.plan}` : ""}
          </p>
          <p className="text-muted-foreground">
            {account.reconnectRequired ? "Reconnect to restore access" : "Connected"}
          </p>
        </div>
      )}
      {challenge ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-[13px]">Open ChatGPT and enter this code:</p>
          <code className="block w-fit rounded-lg bg-muted px-4 py-3 text-lg tracking-widest">
            {challenge.userCode}
          </code>
          <div className="flex flex-wrap gap-3">
            <a
              className="text-sm underline underline-offset-4"
              href={challenge.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Authorize in ChatGPT
            </a>
            <Button
              variant="outline"
              onClick={() => {
                const id = challenge.id;
                active.current = null;
                setChallenge(null);
                void cancelChatGPTConnection({ data: { id } }).catch(() =>
                  setError("Could not cancel sign-in."),
                );
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Waiting for authorization… This code expires in 10 minutes.
          </p>
          <p className="text-xs text-muted-foreground">
            If needed, enable device code authorization in{" "}
            <a
              className="underline"
              href="https://chatgpt.com/#settings/Security"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT security settings
            </a>
            .
          </p>
        </div>
      ) : (
        connection?.configured && (
          <div className="mt-4 flex gap-2">
            <Button disabled={busy} onClick={() => void start()}>
              {busy ? "Working…" : account ? "Reconnect ChatGPT" : "Connect ChatGPT"}
            </Button>
            {account && (
              <Button variant="outline" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            )}
          </div>
        )
      )}
      {(error || loadError) && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error || loadError}
        </p>
      )}
    </section>
  );
}
