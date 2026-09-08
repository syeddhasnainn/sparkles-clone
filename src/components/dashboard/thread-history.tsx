import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useWorkspaces } from "../../hooks/use-workspaces";

const statusLabels = {
  provisioning: "Preparing",
  ready: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
};

export function ThreadHistory() {
  const { data, error, refresh } = useWorkspaces();
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const threads = data.workspaces.filter((thread) =>
    `${thread.prompt}\n${thread.repository.name}`.toLocaleLowerCase().includes(search),
  );

  return (
    <section className="thread-history" aria-labelledby="history-title">
      <header>
        <h1 id="history-title">History</h1>
        <p>All your threads, newest first.</p>
      </header>
      <input
        className="history-search"
        type="search"
        aria-label="Search threads"
        placeholder="Search threads or repositories…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && (
        <div className="workspace-error" role="status">
          <p>{error}</p>
          <button type="button" className="underline" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      <p className="history-count" role="status">
        {threads.length} {threads.length === 1 ? "thread" : "threads"}
      </p>
      {threads.length > 0 ? (
        <ul className="history-list">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                to="/app/tasks/$taskId"
                params={{ taskId: thread.id }}
                className="history-thread"
                aria-label={`${thread.prompt} — ${thread.repository.name}, ${statusLabels[thread.status]}`}
              >
                <span className="history-thread-title">{thread.prompt}</span>
                <span className="history-thread-details">
                  <span className="history-repository">{thread.repository.name}</span>
                  <span>{statusLabels[thread.status]}</span>
                  <time dateTime={new Date(thread.createdAt).toISOString()}>
                    {new Date(thread.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : search ? (
        <p>No threads match your search.</p>
      ) : !error ? (
        <p>
          Your threads will appear here.{" "}
          <Link to="/app" className="underline">
            Start a new chat
          </Link>
        </p>
      ) : null}
    </section>
  );
}
