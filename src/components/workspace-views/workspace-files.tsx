import { WorkspaceChanges } from "./workspace-changes";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
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
  const [split, setSplit] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loadedCounts, setLoadedCounts] = useState<Record<string, number>>({});
  const reportAdditions = useCallback((key: string, count: number) => {
    setLoadedCounts((previous) =>
      previous[key] === count ? previous : { ...previous, [key]: count },
    );
  }, []);
  const additions = files?.files.map(
    (item) => item.additions ?? loadedCounts[`${base}:${item.path}`],
  );
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
    if (!active || scope !== "all") return;
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
  }, [taskId, active, base, files, revision, scope]);
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
            Changes
          </button>
          <button
            aria-pressed={scope === "all"}
            onClick={() => {
              setScope("all");
              setSelected(null);
            }}
          >
            All files
          </button>
        </div>
        <select
          aria-label="Compare files against"
          value={base}
          onChange={(event) => setBase(event.target.value === "head" ? "head" : "task")}
        >
          <option value="task">All changes</option>
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
      {scope === "changed" ? (
        <>
          <div className="workspace-changes-summary">
            <span>
              {files?.files.length ?? 0} {files?.files.length === 1 ? "file" : "files"}
            </span>
            <span className="changes-additions" title="? means some line counts are unavailable">
              +
              {additions?.some((count) => count === undefined)
                ? "?"
                : (additions?.reduce<number>((sum, count) => sum + (count ?? 0), 0) ?? 0)}
            </span>
            <span className="changes-deletions">
              −
              {files?.files.some((item) => item.deletions === null)
                ? "?"
                : (files?.files.reduce((sum, item) => sum + (item.deletions ?? 0), 0) ?? 0)}
            </span>
            <div className="workspace-segments">
              <button aria-pressed={split} onClick={() => setSplit((value) => !value)}>
                Split
              </button>
              <button onClick={() => setCollapsed((value) => !value)}>
                {collapsed ? "Expand all" : "Collapse all"}
              </button>
            </div>
          </div>
          {files ? (
            <WorkspaceChanges
              taskId={taskId}
              files={files}
              base={base}
              split={split}
              collapsed={collapsed}
              reportAdditions={reportAdditions}
            />
          ) : (
            <p className="workspace-file-placeholder">Loading changes…</p>
          )}
        </>
      ) : (
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
                <small
                  className={`file-status file-status-${item.status}`}
                  aria-label={item.status}
                >
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
            {files?.files.length === 0 && <p>No files found.</p>}
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
      )}
    </div>
  );
}
