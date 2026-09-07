import { AppIcon } from "../ui/app-icon";
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Link } from "@tanstack/react-router";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { useGitHubConnection } from "@/hooks/use-github-connection";
import type { GitHubRepository } from "@/lib/github/functions";
import { DashboardIcon } from "./dashboard-icon";
import { RepositoryList } from "./repository-list";

export function RepositoryPicker({
  selected,
  onSelect,
}: {
  selected: GitHubRepository | null;
  onSelect: (repository: GitHubRepository) => void;
}) {
  const { connection, loading, error, reload } = useGitHubConnection();
  const [open, setOpen] = useState(false);
  const triggerClass =
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

  if (loading) {
    return (
      <button type="button" className={triggerClass} disabled>
        <DashboardIcon name="github" size={14} />
        Loading GitHub…
      </button>
    );
  }

  if (error) {
    return (
      <button type="button" className={triggerClass} onClick={() => void reload()}>
        <DashboardIcon name="github" size={14} />
        Retry GitHub connection
      </button>
    );
  }

  if (!connection?.configured) {
    return (
      <Link to="/app/settings/integrations" className={triggerClass}>
        <DashboardIcon name="github" size={14} />
        Connect GitHub
      </Link>
    );
  }

  if (!connection.account || connection.account.reconnectRequired) {
    return (
      <Link to="/api/github/connect" reloadDocument preload={false} className={triggerClass}>
        <DashboardIcon name="github" size={14} />
        {connection.account ? "Reconnect GitHub" : "Connect GitHub"}
      </Link>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={triggerClass}
        aria-label={selected ? `Repository: ${selected.name}` : "Choose a repository"}
      >
        <DashboardIcon name="github" size={14} />
        <span className="max-w-48 truncate">
          {selected?.name.split("/").at(-1) ?? "Choose repository"}
        </span>
        <AppIcon icon={ChevronDown} className="size-3" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-72 max-w-[calc(100vw-2rem)] max-h-[var(--available-height)] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none">
            <Popover.Title className="px-2.5 py-2 text-xs font-medium text-muted-foreground">
              Repositories
            </Popover.Title>
            {open && (
              <RepositoryList
                selected={selected}
                installationUrl={connection.installationUrl!}
                onSelect={(repo) => {
                  onSelect(repo);
                  setOpen(false);
                }}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
