import { Button } from "../ui/button";
import { useChatGPTSettings } from "./use-chatgpt-settings";

export function ChatGPTSettings() {
  const { connection, loadError, challenge, busy, error, start, disconnect, cancel } =
    useChatGPTSettings();
  const account = connection?.account;
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
      <ConnectionStatus connection={connection} loadError={loadError} />
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
            <Button variant="outline" onClick={cancel}>
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

function ConnectionStatus({
  connection,
  loadError,
}: Pick<ReturnType<typeof useChatGPTSettings>, "connection" | "loadError">) {
  const account = connection?.account;
  return (
    <>
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
    </>
  );
}
