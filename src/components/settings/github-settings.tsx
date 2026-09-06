import { AppIcon } from "../ui/app-icon";
import { Link } from "@tanstack/react-router";
import ExternalLink from "@hugeicons/core-free-icons/LinkSquare02Icon";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { useGitHubConnection } from "@/hooks/use-github-connection";
import { DashboardIcon } from "@/components/dashboard/dashboard-icon";
import { SettingsHeading } from "./settings-heading";
import { DisconnectGitHub } from "./disconnect-github";

const notices = new Map([
  ["failed", "We couldn’t connect GitHub. Please try again."],
  ["cancelled", "GitHub authorization was cancelled. You can try again whenever you’re ready."],
  ["unavailable", "GitHub connections aren’t available yet. Please try again later."],
]);

function GitHubConnection() {
  const { connection, loading, error, reload } = useGitHubConnection();
  const account = connection?.account;

  if (loading) {
    return (
      <p role="status" className="mt-5 text-sm text-muted-foreground">
        Loading GitHub connection…
      </p>
    );
  }

  if (error) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm">
          Couldn’t load your connection.
        </p>
        <Button variant="outline" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!connection?.configured) {
    return (
      <p className="mt-5 text-sm text-muted-foreground">GitHub connections aren’t available yet.</p>
    );
  }

  if (!account) {
    return (
      <div className="mt-5 space-y-3">
        <Link to="/api/github/connect" reloadDocument preload={false} className={buttonVariants()}>
          Connect GitHub
        </Link>
        <p className="text-xs text-muted-foreground">
          Authorize your account, then install the app on the repositories you choose.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center gap-3">
        <img src={account.avatarUrl} alt="" className="size-9 rounded-full" />
        <div>
          <p className="text-[13px] font-normal">@{account.login}</p>
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
              <AppIcon icon={ExternalLink} className="size-3.5" />
            </a>
          </>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Repository access is controlled on GitHub. Disconnecting removes this account’s connection
        to Sparkles; it doesn’t uninstall the app from shared organizations.
      </p>
      <DisconnectGitHub login={account.login} onDisconnected={reload} />
    </div>
  );
}

export function GitHubSettings({ status }: { status?: string }) {
  const notice = notices.get(status ?? "");

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
                <h2 id="github-heading" className="text-sm font-normal">
                  GitHub
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the repositories Sparkles can access.
                </p>
              </div>
            </div>
            <GitHubConnection />
          </section>
        </div>
      </div>
    </>
  );
}
