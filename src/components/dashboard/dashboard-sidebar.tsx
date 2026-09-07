import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { AppIcon } from "../ui/app-icon";
import { Link } from "@tanstack/react-router";
import Eye from "@hugeicons/core-free-icons/ViewIcon";
import FolderPlus from "@hugeicons/core-free-icons/FolderAddIcon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import { useWorkspaces } from "@/hooks/use-workspaces";
import WorkflowCircle04Icon from "@hugeicons/core-free-icons/WorkflowCircle04Icon";
import { DashboardIcon } from "./dashboard-icon";

export function DashboardSidebar({
  onToggle,
  onNewChat,
  onNavigate,
}: {
  onToggle: () => void;
  onNewChat: () => void;
  onNavigate: () => void;
}) {
  const { data, error } = useWorkspaces();
  const recent = data?.workspaces.slice(0, 20);
  return (
    <aside className="dashboard-sidebar" id="dashboard-sidebar" aria-label="Dashboard sidebar">
      <div className="sidebar-brand">
        <Link to="/app" aria-label="Sparkles dashboard" onClick={onNavigate}>
          <img src="/brand/sparkles.svg" alt="Sparkles" />
        </Link>
        <Tooltip>
          <TooltipTrigger render={<span className="folder-button" />}>
            <button
              className="icon-button"
              aria-label="New folder"
              disabled
              style={{ pointerEvents: "none" }}
            >
              <AppIcon icon={FolderPlus} size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New folder — coming soon</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            className="icon-button sidebar-toggle"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            aria-expanded={true}
            aria-controls="dashboard-sidebar"
          >
            <DashboardIcon name="sidebar" size={16} />
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
        </Tooltip>
      </div>
      <div className="sidebar-actions">
        <div className="new-chat-group">
          <Link to="/app" onClick={onNewChat} className="new-chat-button">
            <AppIcon icon={Plus} size={14} />
            New chat
          </Link>
        </div>
      </div>
      <div className="sidebar-content">
        <nav aria-label="Dashboard navigation" className="sidebar-nav">
          {[
            ["backlog", "Backlog"],
            ["automations", "Automations"],
            ["history", "History"],
          ].map(([icon, label]) => (
            <button key={icon} className="nav-item" disabled>
              <DashboardIcon name={icon} size={14} />
              {label}
              {(icon === "backlog" || icon === "automations") && (
                <span className="sidebar-coming-soon">Coming soon</span>
              )}
            </button>
          ))}
        </nav>
        <section className="conversation-section" aria-label="Private conversations">
          <h2 className="section-label">Private</h2>
          {recent?.length ? (
            <nav className="conversation-list" aria-label="Recent tasks">
              {recent.map((task) => (
                <Link
                  key={task.id}
                  to="/app/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="conversation-row"
                  activeProps={{ className: "conversation-row-active", "aria-current": "page" }}
                  onClick={onNavigate}
                  title={task.prompt}
                >
                  <AppIcon
                    icon={WorkflowCircle04Icon}
                    size={14}
                    className="conversation-repository-icon"
                    aria-hidden="true"
                  />
                  <span className="conversation-copy">
                    <span className="conversation-title">{task.prompt}</span>
                    <span className="conversation-repository">
                      {task.repository.name.split("/").at(-1)}
                    </span>
                  </span>
                  <span
                    className={`conversation-status conversation-status-${task.status}`}
                    aria-label={task.status}
                  />
                </Link>
              ))}
            </nav>
          ) : (
            <p className="sidebar-empty">
              {error
                ? "Could not load recent chats."
                : recent
                  ? "Your recent chats will appear here."
                  : "Loading chats…"}
            </p>
          )}
        </section>
        <section className="team-section">
          <h2 className="section-label">
            Team
            <AppIcon icon={Eye} size={14} />
          </h2>
          <div className="empty-folder">Drop a chat here to share it</div>
        </section>
      </div>
      <div className="sidebar-footer">
        <Link to="/app/settings/account" className="nav-item" onClick={onNavigate}>
          <DashboardIcon name="settings" size={14} />
          Settings
        </Link>
      </div>
    </aside>
  );
}
