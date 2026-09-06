import { createPortal } from "react-dom";
import { TaskHeaderContext } from "../dashboard/dashboard-header";
import { useContext, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import { AppIcon } from "../ui/app-icon";
import { WorkspaceFiles } from "./workspace-files";
import { WorkspaceLiveView } from "./workspace-live-view";

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
  children,
}: {
  taskId: string;
  sandboxId?: string | null;
  ready: boolean;
  children: ReactNode;
}) {
  const headerElement = useContext(TaskHeaderContext);
  const [view, setView] = useState<View>("desktop");
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(55);
  const [resizing, setResizing] = useState(false);
  const layout = useRef<HTMLDivElement>(null);
  const activeIcon = views.find((item) => item.id === view)?.icon ?? File01Icon;
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
        {children}
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
                <div className="workspace-view-empty">
                  <AppIcon icon={activeIcon} size={30} />
                  <h3>Workspace is offline</h3>
                  <p>
                    Resume this workspace to browse files or open its live views. Your conversation
                    and draft are still available.
                  </p>
                </div>
              ) : view === "files" ? (
                <WorkspaceFiles key={sandboxId} taskId={taskId} />
              ) : (
                <WorkspaceLiveView key={`${sandboxId}:${view}`} taskId={taskId} service={view} />
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
