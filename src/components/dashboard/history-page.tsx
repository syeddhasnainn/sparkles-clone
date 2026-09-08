import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useWorkspaces } from "../../hooks/use-workspaces";
import { ConversationActivity } from "./conversation-activity";

const statusLabels = {
  provisioning: "Preparing",
  ready: "Ready",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Setup failed",
};

export function HistoryPage() {
  const { data, error, refresh } = useWorkspaces();
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const workspaces = data.workspaces
    .filter((task) => `${task.prompt}\n${task.repository.name}`.toLowerCase().includes(search))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="history-page" aria-labelledby="history-heading">
      <h1 id="history-heading">History</h1>
      <p className="history-description">Browse and continue your past chats.</p>
      <label className="sr-only" htmlFor="history-search">
        Search history
      </label>
      <input
        id="history-search"
        className="history-search"
        type="search"
        placeholder="Search chats or repositories…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && (
        <div className="history-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {workspaces.length ? (
        <ul className="history-list">
          {workspaces.map((task) => (
            <li key={task.id}>
              <Link to="/app/tasks/$taskId" params={{ taskId: task.id }} className="history-row">
                <span className="history-copy">
                  <span className="history-title">{task.prompt}</span>
                  <span className="history-repository">{task.repository.name}</span>
                  {task.activity && (
                    <ConversationActivity
                      activity={task.activity}
                      repository={task.repository.name}
                    />
                  )}
                </span>
                <span className="history-meta">
                  <span>{statusLabels[task.status]}</span>
                  <time dateTime={new Date(task.createdAt).toISOString()}>
                    {new Date(task.createdAt).toISOString().slice(0, 10)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="history-empty">
          <p>
            {search
              ? "No chats match your search."
              : error
                ? "History is unavailable."
                : "No chats yet."}
          </p>
          {search ? (
            <button type="button" onClick={() => setQuery("")}>
              Clear search
            </button>
          ) : (
            !error && <Link to="/app">Start a new chat</Link>
          )}
        </div>
      )}
    </section>
  );
}
