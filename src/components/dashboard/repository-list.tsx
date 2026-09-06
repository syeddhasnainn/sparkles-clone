import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Lock, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  listGitHubInstallations,
  listGitHubRepositories,
  type GitHubRepository,
} from "@/lib/github/functions";

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
  const fetchRepositories = useServerFn(listGitHubRepositories);

  const [installations, setInstallations] = useState<{ id: number; login: string }[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [installationPage, setInstallationPage] = useState(1);
  const [moreInstallations, setMoreInstallations] = useState(false);

  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [page, setPage] = useState(1);
  const [moreRepositories, setMoreRepositories] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(false);

    fetchInstallations({ data: { page: 1 } })
      .then((result) => {
        if (!active) {
          return;
        }

        setInstallations(result.installations);
        setInstallationPage(1);
        setMoreInstallations(result.hasMore);
        setInstallationId(
          result.installations.find((item) => item.id === selected?.installationId)?.id ??
            result.installations[0]?.id ??
            null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [fetchInstallations, retry, selected?.installationId]);

  useEffect(() => {
    if (!installationId) {
      return;
    }

    let active = true;

    setLoading(true);
    setError(false);
    setRepositories([]);
    setSearch("");
    setPage(1);

    fetchRepositories({ data: { installationId, page: 1 } })
      .then((result) => {
        if (!active) {
          return;
        }

        setRepositories(result.repositories);
        setMoreRepositories(result.hasMore);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [fetchRepositories, installationId, retry]);

  const filtered = repositories.filter((repo) =>
    repo.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {installations.length > 0 && (
        <div className="px-3 pt-3">
          <label className="sr-only" htmlFor="github-account">
            GitHub account or organization
          </label>
          <select
            id="github-account"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            value={installationId ?? ""}
            disabled={loadingMore}
            onChange={(event) => setInstallationId(Number(event.target.value))}
          >
            {installations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.login}
              </option>
            ))}
          </select>
          {moreInstallations && (
            <Button
              variant="link"
              size="xs"
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                setError(false);

                try {
                  const next = await fetchInstallations({ data: { page: installationPage + 1 } });

                  setInstallations((items) => [...items, ...next.installations]);
                  setInstallationPage((value) => value + 1);
                  setMoreInstallations(next.hasMore);
                } catch {
                  setError(true);
                } finally {
                  setLoadingMore(false);
                }
              }}
            >
              Load more accounts
            </Button>
          )}
        </div>
      )}
      {repositories.length > 0 && (
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
      )}
      <div className="max-h-72 overflow-y-auto p-2">
        {loading ? (
          <p role="status" className="p-3 text-xs text-muted-foreground">
            Loading repositories…
          </p>
        ) : error ? (
          <div className="space-y-2 p-3">
            <p role="alert" className="text-xs">
              Couldn’t load repositories. Try again or reconnect GitHub in settings.
            </p>
            <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </Button>
          </div>
        ) : installations.length === 0 ? (
          <p className="p-3 text-xs leading-relaxed text-muted-foreground">
            Install the Sparkles GitHub App to choose which repositories you want to connect.
          </p>
        ) : (
          <>
            {filtered.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                {search
                  ? "No loaded repositories match your search."
                  : "No repositories are available for this account."}
              </p>
            )}
            {filtered.map((repo) => (
              <button
                type="button"
                key={repo.id}
                onClick={() => onSelect(repo)}
                aria-pressed={selected?.id === repo.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{repo.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {repo.defaultBranch}
                    {repo.archived ? " · Archived" : ""}
                  </span>
                </span>
                {repo.private && (
                  <Lock className="size-3 shrink-0" aria-label="Private repository" />
                )}
                {selected?.id === repo.id && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
            {moreRepositories && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                disabled={loadingMore}
                onClick={async () => {
                  if (!installationId) {
                    return;
                  }

                  setLoadingMore(true);

                  try {
                    const next = await fetchRepositories({
                      data: { installationId, page: page + 1 },
                    });

                    setRepositories((items) => [...items, ...next.repositories]);
                    setPage((value) => value + 1);
                    setMoreRepositories(next.hasMore);
                  } catch {
                    setError(true);
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                {loadingMore ? "Loading…" : "Load more repositories"}
              </Button>
            )}
          </>
        )}
      </div>
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
