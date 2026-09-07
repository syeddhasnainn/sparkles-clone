import { createPortal } from "react-dom";
import { TaskHeaderContext } from "../dashboard/task-header-context";
import { useContext, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import { AppIcon } from "../ui/app-icon";
import { WorkspaceFiles } from "./workspace-files";
import { WorkspaceLiveView } from "./workspace-live-view";
import { WorkspacePreviewContext } from "./workspace-preview-context";
import { requestView } from "./view-client";

const views = [
  { id: "files", label: "Files", icon: File01Icon },
  { id: "preview", label: "Preview", icon: ViewIcon },
  { id: "desktop", label: "Desktop", icon: ComputerIcon },
] as const;
type View = (typeof views)[number]["id"];

export function TaskWorkbench({
  taskId,
  sandboxId,
  ready,
  status,
  restoring,
  canResume,
  onStart,
  onStartPreview,
  canStartPreview,
  agentWorking,
  children,
}: {
  taskId: string;
  sandboxId?: string | null;
  ready: boolean;
  status?: string;
  restoring?: boolean;
  canResume: boolean;
  onStart: () => Promise<boolean>;
  onStartPreview: () => Promise<boolean>;
  canStartPreview: boolean;
  agentWorking: boolean;
  children: ReactNode;
}) {
  const headerElement = useContext(TaskHeaderContext);
  const [view, setView] = useState<View>("desktop");
  const [open, setOpen] = useState(false);
  const [startView, setStartView] = useState<View | null>(null);
  const [width, setWidth] = useState(55);
  const [resizing, setResizing] = useState(false);
  const layout = useRef<HTMLDivElement>(null);
  const panelStyle: CSSProperties & { "--workspace-panel-width": string } = {
    "--workspace-panel-width": `${width}%`,
  };
  return (
    <div
      ref={layout}
      className={`task-workbench ${open ? "has-view" : ""} ${resizing ? "is-resizing" : ""}`}
      style={panelStyle}
    >
      {headerElement &&
        createPortal(
          <button
            className="icon-button workspace-sidebar-toggle"
            aria-label={open ? "Hide workspace panel" : "Show workspace panel"}
            title={open ? "Hide workspace panel" : "Show workspace panel"}
            aria-expanded={open}
            aria-controls="workspace-view-panel"
            onClick={() => setOpen((value) => !value)}
          >
            <AppIcon icon={SidebarRightIcon} size={16} />
          </button>,
          headerElement,
        )}
      <div className="task-workbench-layout">
        <WorkspacePreviewContext
          value={() => {
            setView("preview");
            setOpen(true);
          }}
        >
          {children}
        </WorkspacePreviewContext>
        {open && (
          <>
            <div
              className="workspace-panel-resizer"
              role="separator"
              tabIndex={0}
              aria-label="Resize conversation and workspace panels"
              aria-orientation="vertical"
              aria-valuemin={30}
              aria-valuemax={70}
              aria-valuenow={width}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setResizing(true);
              }}
              onPointerMove={(event) => {
                if (!resizing || !layout.current) return;
                const bounds = layout.current.getBoundingClientRect();
                setWidth(
                  Math.min(70, Math.max(30, ((bounds.right - event.clientX) / bounds.width) * 100)),
                );
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                setResizing(false);
              }}
              onPointerCancel={() => setResizing(false)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                setWidth((value) =>
                  Math.min(70, Math.max(30, value + (event.key === "ArrowLeft" ? 2 : -2))),
                );
              }}
            />
            <aside
              id="workspace-view-panel"
              className="workspace-view-panel"
              aria-label={`${view} panel`}
            >
              <div className="workspace-view-bar" role="toolbar" aria-label="Workspace views">
                {views.map((item) => (
                  <button
                    key={item.id}
                    aria-label={item.label}
                    aria-pressed={view === item.id}
                    onClick={() => setView(item.id)}
                  >
                    <AppIcon icon={item.icon} size={14} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              {!ready ? (
                <OfflineWorkspace
                  view={view}
                  status={status}
                  restoring={restoring}
                  canResume={canResume}
                  startDisabled={view === "preview" && !canStartPreview}
                  onStart={async () => {
                    setStartView(view);
                    return view === "preview" ? onStartPreview() : onStart();
                  }}
                />
              ) : view === "files" ? (
                <WorkspaceFiles key={sandboxId} taskId={taskId} />
              ) : (
                <WorkspaceLiveView
                  key={`${sandboxId}:${view}`}
                  taskId={taskId}
                  service={view}
                  autoStartDesktop={startView === "desktop"}
                  onStartPreview={onStartPreview}
                  canStartPreview={canStartPreview}
                  agentWorking={agentWorking}
                  request={requestView}
                />
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function OfflineWorkspace({
  view,
  status,
  restoring,
  canResume,
  onStart,
  startDisabled,
}: {
  view: View;
  status?: string;
  restoring?: boolean;
  canResume: boolean;
  onStart: () => Promise<boolean>;
  startDisabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = pending || status === "provisioning" || status === "stopping";
  const icon = views.find((item) => item.id === view)?.icon ?? File01Icon;
  const start = async () => {
    setPending(true);
    setError(false);
    try {
      setError(!(await onStart()));
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="workspace-view-empty">
      <AppIcon icon={icon} size={30} />
      <h3>
        {status === "stopping"
          ? "Saving workspace…"
          : busy
            ? restoring
              ? "Restoring workspace…"
              : "Starting sandbox…"
            : status === "failed"
              ? "Workspace startup failed"
              : "Workspace is offline"}
      </h3>
      <p>
        {status === "stopping"
          ? "The sandbox session ended. Finishing its save before it can be resumed."
          : busy
            ? "Restoring your files and preparing the workspace."
            : "Start the sandbox to open your workspace view. Your conversation and files will be restored."}
      </p>
      {view !== "files" && (
        <button
          className="workspace-primary-button"
          disabled={busy || !canResume || startDisabled}
          onClick={() => void start()}
        >
          {busy ? "Starting…" : view === "preview" ? "Start preview" : "Start desktop"}
        </button>
      )}
      {error && <p role="alert">Could not start the sandbox. Please try again.</p>}
      {!busy && status && !canResume && <p>No saved workspace is available to restore.</p>}
    </div>
  );
}
