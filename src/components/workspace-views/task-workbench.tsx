import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
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
  const [view, setView] = useState<View | null>(null);
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
      className={`task-workbench ${view ? "has-view" : ""} ${resizing ? "is-resizing" : ""}`}
      style={panelStyle}
    >
      <div className="workspace-view-bar" role="toolbar" aria-label="Workspace views">
        {views.map((item) => (
          <button
            key={item.id}
            aria-pressed={view === item.id}
            aria-controls="workspace-view-panel"
            onClick={() => setView((previous) => (previous === item.id ? null : item.id))}
          >
            <AppIcon icon={item.icon} size={16} />
            <span>{item.label}</span>
          </button>
        ))}
        {view && (
          <button
            className="icon-button"
            aria-label="Close workspace view"
            onClick={() => setView(null)}
          >
            <AppIcon icon={Cancel01Icon} size={15} />
          </button>
        )}
      </div>
      <div className="task-workbench-layout">
        {children}
        {view && (
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
