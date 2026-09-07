import { AppIcon } from "../ui/app-icon";
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Check from "@hugeicons/core-free-icons/Tick02Icon";
import { DashboardIcon } from "./dashboard-icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import { Button } from "@/components/ui/button";
import { usePaginatedItems } from "@/hooks/use-paginated-items";
import { listGitHubRepositories, type GitHubRepository } from "@/lib/github/functions";
import { RepositoryLoadError } from "./repository-load-error";

function RepositoryOption({
  repo,
  selected,
  onSelect,
}: {
  repo: GitHubRepository;
  selected: boolean;
  onSelect: (repository: GitHubRepository) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(repo)}
      aria-pressed={selected}
      title={`${repo.name}${repo.private ? " · Private" : ""}${repo.archived ? " · Archived" : ""}`}
      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <DashboardIcon name="github" size={15} />
      <span className="min-w-0 flex-1 truncate">{repo.name.split("/").at(-1)}</span>
      {selected && <AppIcon icon={Check} className="size-3.5 shrink-0" />}
    </button>
  );
}

export function InstallationRepositories({
  installationId,
  selected,
  onSelect,
}: {
  installationId: number;
  selected: GitHubRepository | null;
  onSelect: (repository: GitHubRepository) => void;
}) {
  const fetchRepositories = useServerFn(listGitHubRepositories);
  const loadPage = useCallback(
    async (page: number) => {
      const result = await fetchRepositories({ data: { installationId, page } });

      return { items: result.repositories, hasMore: result.hasMore };
    },
    [fetchRepositories, installationId],
  );
  const repositories = usePaginatedItems(loadPage);
  const [search, setSearch] = useState("");
  const filtered = repositories.items.filter((repo) =>
    repo.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (repositories.status === "loading") {
    return (
      <p role="status" className="p-3 text-xs text-muted-foreground">
        Loading repositories…
      </p>
    );
  }

  if (repositories.status === "error") {
    return <RepositoryLoadError onRetry={repositories.retry} />;
  }

  return (
    <>
      {(repositories.items.length > 6 || repositories.hasMore) && (
        <label className="mx-2 mb-1 flex items-center gap-2 text-muted-foreground">
          <AppIcon icon={Search} className="size-3.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search repositories…"
            aria-label="Filter loaded repositories"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
          />
        </label>
      )}
      <div className="max-h-80 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {search
              ? "No loaded repositories match your search."
              : "No repositories are available for this account."}
          </p>
        )}
        {filtered.map((repo) => (
          <RepositoryOption
            key={repo.id}
            repo={repo}
            selected={selected?.id === repo.id}
            onSelect={onSelect}
          />
        ))}
        {repositories.hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            disabled={repositories.loadingMore}
            onClick={() => void repositories.loadMore()}
          >
            {repositories.loadingMore ? "Loading…" : "Load more repositories"}
          </Button>
        )}
      </div>
    </>
  );
}
