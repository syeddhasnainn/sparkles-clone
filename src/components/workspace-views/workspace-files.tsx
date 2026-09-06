import { lazy, Suspense, useEffect, useState } from "react";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { AppIcon } from "../ui/app-icon";
import { requestView } from "./view-client";
import type {
  WorkspaceFile,
  WorkspaceFiles as FileList,
} from "../../../bridge/workspace-view-contracts";

const FileViewer = lazy(() => import("./workspace-file-viewer"));

export function WorkspaceFiles({ taskId }: { taskId: string }) {
  const [scope, setScope] = useState<"changed" | "all">("changed");
  const [base, setBase] = useState<"task" | "head">("task");
  const [files, setFiles] = useState<FileList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const refresh = async (initial = false) => {
      if (loading || (!initial && document.hidden)) return;
      loading = true;
      try {
        const next = await requestView(taskId, { kind: "files", scope, base });
        if (!cancelled && next.kind === "files") {
          setFiles(next);
          setError(null);
        }
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not load files.");
      } finally {
        loading = false;
      }
    };
    void refresh(true);
    const interval = setInterval(() => void refresh(), 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [taskId, scope, base, revision]);
  const active = selected ?? files?.files[0]?.path ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!active) return;
    void requestView(taskId, { kind: "file", path: active, base })
      .then((next) => {
        if (!cancelled && next.kind === "file") setFile(next);
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not open file.");
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, active, base, files, revision]);
  return (
    <div className="workspace-files">
      <div className="workspace-panel-toolbar">
        <div className="workspace-segments" aria-label="File scope">
          <button
            aria-pressed={scope === "changed"}
            onClick={() => {
              setScope("changed");
              setSelected(null);
            }}
          >
            Changed
          </button>
          <button
            aria-pressed={scope === "all"}
            onClick={() => {
              setScope("all");
              setSelected(null);
            }}
          >
            All
          </button>
        </div>
        <select
          aria-label="Compare files against"
          value={base}
          onChange={(event) => setBase(event.target.value === "head" ? "head" : "task")}
        >
          <option value="task">Since task started</option>
          <option value="head">Uncommitted</option>
        </select>
        <button
          className="icon-button"
          aria-label="Refresh files"
          onClick={() => setRevision((value) => value + 1)}
        >
          <AppIcon icon={RefreshIcon} size={16} />
        </button>
      </div>
      {error && (
        <p className="workspace-view-error" role="alert">
          {error}
        </p>
      )}
      <div className="workspace-file-layout">
        <nav className="workspace-file-list" aria-label="Repository files">
          {files?.files.map((item) => (
            <button
              key={item.path}
              aria-current={active === item.path ? "true" : undefined}
              title={item.path}
              onClick={() => setSelected(item.path)}
            >
              <AppIcon icon={File01Icon} size={14} />
              <span>{item.path}</span>
              <small className={`file-status file-status-${item.status}`} aria-label={item.status}>
                {item.status === "added"
                  ? "+"
                  : item.status === "deleted"
                    ? "−"
                    : item.status === "modified"
                      ? "M"
                      : ""}
              </small>
            </button>
          ))}
          {!files && !error && <p>Loading files…</p>}
          {files?.files.length === 0 && (
            <p>{scope === "changed" ? "No changes yet." : "No files found."}</p>
          )}
          {files?.truncated && <p>Showing the first 2,000 files.</p>}
        </nav>
        <div className="workspace-file-content">
          {active && file?.path === active ? (
            <Suspense fallback={<p className="workspace-file-placeholder">Loading viewer…</p>}>
              <FileViewer file={file} />
            </Suspense>
          ) : (
            <div className="workspace-view-empty">
              <AppIcon icon={File01Icon} size={28} />
              <h3>{active ? "Loading file…" : "Repository files"}</h3>
              <p>{active ? active : "Changes will appear as your task progresses."}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
