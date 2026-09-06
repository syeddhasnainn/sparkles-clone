import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { usePaginatedItems } from "@/hooks/use-paginated-items";
import { listGitHubInstallations, type GitHubRepository } from "@/lib/github/functions";
import { InstallationRepositories } from "./installation-repositories";
import { RepositoryLoadError } from "./repository-load-error";

export function RepositoryList({
  selected,
  installationUrl,
  onSelect,
}: {
  selected: GitHubRepository | null;
  installationUrl: string;
  onSelect: (repository: GitHubRepository) => void;
}) {
  const fetchInstallations = useServerFn(listGitHubInstallations);
  const loadPage = useCallback(
    async (page: number) => {
      const result = await fetchInstallations({ data: { page } });

      return { items: result.installations, hasMore: result.hasMore };
    },
    [fetchInstallations],
  );
  const accounts = usePaginatedItems(loadPage);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const preferredId = chosenId ?? selected?.installationId;
  const installationId =
    accounts.items.find((item) => item.id === preferredId)?.id ?? accounts.items[0]?.id;

  return (
    <>
      {accounts.items.length > 0 && (
        <div className="px-3 pt-3">
          <label className="sr-only" htmlFor="github-account">
            GitHub account or organization
          </label>
          <select
            id="github-account"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            value={installationId}
            disabled={accounts.loadingMore}
            onChange={(event) => setChosenId(Number(event.target.value))}
          >
            {accounts.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.login}
              </option>
            ))}
          </select>
          {accounts.hasMore && (
            <Button
              variant="link"
              size="xs"
              disabled={accounts.loadingMore}
              onClick={() => void accounts.loadMore()}
            >
              Load more accounts
            </Button>
          )}
        </div>
      )}
      {accounts.status === "loading" && (
        <p role="status" className="p-3 text-xs text-muted-foreground">
          Loading accounts…
        </p>
      )}
      {accounts.status === "error" && <RepositoryLoadError onRetry={accounts.retry} />}
      {accounts.status === "ready" && !installationId && (
        <p className="p-3 text-xs leading-relaxed text-muted-foreground">
          Install the Sparkles GitHub App to choose which repositories you want to connect.
        </p>
      )}
      {installationId && (
        <InstallationRepositories
          key={installationId}
          installationId={installationId}
          selected={selected}
          onSelect={onSelect}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2">
        <a href={installationUrl} className={buttonVariants({ variant: "ghost", size: "xs" })}>
          Manage repository access
        </a>
        <Link
          to="/app/settings/integrations"
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          Settings
        </Link>
      </div>
    </>
  );
}
