import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Lock, Search } from "lucide-react";
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{repo.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {repo.defaultBranch}
          {repo.archived ? " · Archived" : ""}
        </span>
      </span>
      {repo.private && <Lock className="size-3 shrink-0" aria-label="Private repository" />}
      {selected && <Check className="size-3.5 shrink-0" />}
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
      <label className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-input px-2 text-muted-foreground">
        <Search className="size-3.5" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter loaded repositories…"
          aria-label="Filter loaded repositories"
          className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
        />
      </label>
      <div className="max-h-72 overflow-y-auto p-2">
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
