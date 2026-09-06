import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useGitHubConnection } from "@/hooks/use-github-connection";
import { disconnectGitHubAccount } from "@/lib/github/functions";
import { DashboardIcon } from "@/components/dashboard/dashboard-icon";
import { SettingsHeading } from "./settings-heading";

export function GitHubSettings({ status }: { status?: string }) {
  const { connection, loading, error, reload } = useGitHubConnection();
  const disconnect = useServerFn(disconnectGitHubAccount);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const account = connection?.account;
  const notice =
    status === "failed"
      ? "We couldn’t connect GitHub. Please try again."
      : status === "cancelled"
        ? "GitHub authorization was cancelled. You can try again whenever you’re ready."
        : status === "unavailable"
          ? "GitHub connections aren’t available yet. Please try again later."
          : null;

  return (
    <>
      <SettingsHeading title="Integrations" description="Connect the accounts you use to build." />
      <div className="settings-scroll" data-scroll-restoration-id="settings-content">
        <div className="settings-content">
          {notice && (
            <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
              {notice}
            </p>
          )}
          <section
            aria-labelledby="github-heading"
            className="rounded-xl border border-border bg-card p-5 text-card-foreground"
          >
            <div className="flex items-start gap-3">
              <DashboardIcon name="github" size={24} />
              <div>
                <h2 id="github-heading" className="text-base font-semibold">
                  GitHub
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the repositories Sparkles can access.
                </p>
              </div>
            </div>
            {loading ? (
              <p role="status" className="mt-5 text-sm text-muted-foreground">
                Loading GitHub connection…
              </p>
            ) : error ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm">
                  Couldn’t load your connection.
                </p>
                <Button variant="outline" onClick={() => void reload()}>
                  Try again
                </Button>
              </div>
            ) : !connection?.configured ? (
              <p className="mt-5 text-sm text-muted-foreground">
                GitHub connections aren’t available yet.
              </p>
            ) : account ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-3">
                  <img src={account.avatarUrl} alt="" className="size-9 rounded-full" />
                  <div>
                    <p className="text-sm font-medium">@{account.login}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.reconnectRequired ? "Reconnect to restore access" : "Connected"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {account.reconnectRequired ? (
                    <Link
                      to="/api/github/connect"
                      reloadDocument
                      preload={false}
                      className={buttonVariants()}
                    >
                      Reconnect GitHub
                    </Link>
                  ) : (
                    <>
                      <Link to="/app" className={buttonVariants()}>
                        Choose a repository
                      </Link>
                      <a
                        href={connection.installationUrl!}
                        className={buttonVariants({ variant: "outline" })}
                      >
                        Manage repository access
                        <ExternalLink className="size-3.5" />
                      </a>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    disabled={disconnecting}
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    Disconnect
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Repository access is controlled on GitHub. Disconnecting removes this account’s
                  connection to Sparkles; it doesn’t uninstall the app from shared organizations.
                </p>
                {confirmDisconnect && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <p className="text-sm">Disconnect @{account.login} from Sparkles?</p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={disconnecting}
                        onClick={async () => {
                          setDisconnecting(true);
                          setDisconnectError(false);

                          try {
                            await disconnect();
                            setConfirmDisconnect(false);
                            await reload();
                          } catch {
                            setDisconnectError(true);
                          } finally {
                            setDisconnecting(false);
                          }
                        }}
                      >
                        {disconnecting ? "Disconnecting…" : "Disconnect GitHub"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disconnecting}
                        onClick={() => setConfirmDisconnect(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {disconnectError && (
                  <p role="alert" className="text-sm text-destructive">
                    Couldn’t disconnect GitHub. Please try again.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <Link
                  to="/api/github/connect"
                  reloadDocument
                  preload={false}
                  className={buttonVariants()}
                >
                  Connect GitHub
                </Link>
                <p className="text-xs text-muted-foreground">
                  Authorize your account, then install the app on the repositories you choose.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
