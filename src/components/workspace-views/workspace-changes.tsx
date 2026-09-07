import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import { AppIcon } from "../ui/app-icon";
import { requestView } from "./view-client";
import type { WorkspaceFile, WorkspaceFiles } from "../../../bridge/workspace-view-contracts";

const DiffContent = lazy(() =>
  import("./workspace-file-viewer").then((module) => ({ default: module.FileContent })),
);

export function WorkspaceChanges({
  taskId,
  files,
  base,
  split,
  collapsed,
  reportAdditions,
}: {
  taskId: string;
  files: WorkspaceFiles;
  base: "task" | "head";
  split: boolean;
  collapsed: boolean;
  reportAdditions: (key: string, count: number) => void;
}) {
  const [limit, setLimit] = useState(30);
  return (
    <div className="workspace-changes" aria-label="Changed files">
      {files.files.slice(0, limit).map((item) => (
        <ChangeFile
          key={`${base}:${item.path}:${collapsed}`}
          taskId={taskId}
          item={item}
          revision={files}
          base={base}
          split={split}
          initiallyCollapsed={collapsed}
          reportAdditions={reportAdditions}
        />
      ))}
      {files.files.length === 0 && (
        <div className="workspace-view-empty">
          <h3>No changes yet</h3>
          <p>File changes will appear here as your task progresses.</p>
        </div>
      )}
      {limit < files.files.length && (
        <button className="changes-load-more" onClick={() => setLimit((value) => value + 30)}>
          Show more files ({files.files.length - limit} remaining)
        </button>
      )}
      {files.truncated && (
        <p className="workspace-file-placeholder">Showing the first 2,000 files.</p>
      )}
    </div>
  );
}

function ChangeFile({
  taskId,
  item,
  revision,
  base,
  split,
  initiallyCollapsed,
  reportAdditions,
}: {
  taskId: string;
  item: WorkspaceFiles["files"][number];
  revision: WorkspaceFiles;
  base: "task" | "head";
  split: boolean;
  initiallyCollapsed: boolean;
  reportAdditions: (key: string, count: number) => void;
}) {
  const [expanded, setExpanded] = useState(!initiallyCollapsed);
  const [visible, setVisible] = useState(false);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!card.current) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "300px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!expanded || !visible) return;
    let cancelled = false;
    void requestView(taskId, { kind: "file", path: item.path, base })
      .then((result) => {
        if (!cancelled && result.kind === "file") {
          setFile(result);
          if (result.before === null && result.after !== null && !result.binary && !result.tooLarge)
            reportAdditions(`${base}:${item.path}`, lineCount(result.after));
          setError(null);
        }
      })
      .catch((error) => {
        if (!cancelled)
          setError(error instanceof Error ? error.message : "Could not read this file.");
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, item.path, base, expanded, visible, revision, reportAdditions]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <section ref={card} className="workspace-change-file" aria-label={item.path}>
      <ChangeHeading
        item={item}
        file={file}
        expanded={expanded}
        copied={copied}
        onToggle={() => setExpanded((value) => !value)}
        onCopy={() => {
          void navigator.clipboard
            .writeText(item.path)
            .then(() => setCopied(true))
            .catch(() => setError("Could not copy the file path."));
        }}
      />
      {expanded && (
        <div className="workspace-change-content">
          {error && (
            <p className="workspace-view-error" role="alert">
              {error}
            </p>
          )}
          {file ? (
            <Suspense fallback={<p className="workspace-file-placeholder">Loading diff…</p>}>
              <DiffContent file={file} mode="diff" split={split} />
            </Suspense>
          ) : (
            <p className="workspace-file-placeholder">
              {error ? "File unavailable." : "Loading diff…"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function lineCount(text: string) {
  return text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
}

function ChangeHeading({
  item,
  file,
  expanded,
  copied,
  onToggle,
  onCopy,
}: {
  item: WorkspaceFiles["files"][number];
  file: WorkspaceFile | null;
  expanded: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const filename = item.path.split("/").at(-1);
  const directory = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
  const additions =
    item.additions ??
    (file?.before === null && file.after !== null && !file.binary ? lineCount(file.after) : null);
  return (
    <div className="workspace-change-heading">
      <button
        className="workspace-change-toggle"
        aria-expanded={expanded}
        onClick={onToggle}
        title={item.path}
      >
        <AppIcon icon={ArrowDown01Icon} size={14} className={expanded ? "" : "is-collapsed"} />
        <span className="workspace-change-filename">{filename}</span>
        <span className="workspace-change-directory">{directory}</span>
      </button>
      <button
        className="icon-button workspace-change-copy"
        aria-label={copied ? "Path copied" : `Copy path ${item.path}`}
        onClick={onCopy}
      >
        <AppIcon icon={Copy01Icon} size={14} />
      </button>
      <span className="changes-additions">+{additions ?? "?"}</span>
      {(item.deletions === null || item.deletions > 0) && (
        <span className="changes-deletions">−{item.deletions ?? "?"}</span>
      )}
      <span className={`workspace-change-badge file-status-${item.status}`}>{item.status}</span>
    </div>
  );
}
