import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { disconnectGitHubAccount } from "@/lib/github/functions";

export function DisconnectGitHub({
  login,
  onDisconnected,
}: {
  login: string;
  onDisconnected: () => Promise<void>;
}) {
  const disconnect = useServerFn(disconnectGitHubAccount);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");
  const pending = status === "pending";

  async function handleDisconnect() {
    setStatus("pending");

    try {
      await disconnect();
      await onDisconnected();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
        Disconnect
      </Button>
      {confirm && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm">Disconnect @{login} from Sparkles?</p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void handleDisconnect()}
            >
              {pending ? "Disconnecting…" : "Disconnect GitHub"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Couldn’t disconnect GitHub. Please try again.
        </p>
      )}
    </div>
  );
}
