import { Link } from "@tanstack/react-router";
import { ChevronDown, Eye, FolderPlus, Plus } from "lucide-react";
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
  return (
    <aside className="dashboard-sidebar" id="dashboard-sidebar" aria-label="Dashboard sidebar">
      <div className="sidebar-brand">
        <Link to="/app" aria-label="Sparkles dashboard" onClick={onNavigate}>
          <img src="/brand/sparkles.svg" alt="Sparkles" />
        </Link>
        <button
          className="icon-button sidebar-toggle"
          onClick={onToggle}
          aria-label="Collapse sidebar"
        >
          <DashboardIcon name="sidebar" />
        </button>
      </div>
      <div className="sidebar-actions">
        <div className="new-chat-group">
          <Link to="/app" onClick={onNewChat} className="new-chat-button">
            <Plus size={16} />
            New chat
          </Link>
          <button className="new-chat-chevron" aria-label="Start chat in another project" disabled>
            <ChevronDown size={14} />
          </button>
        </div>
        <button className="folder-button" aria-label="New folder" disabled>
          <FolderPlus size={16} />
        </button>
      </div>
      <div className="sidebar-content">
        <nav aria-label="Dashboard navigation" className="sidebar-nav">
          {[
            ["backlog", "Backlog"],
            ["automations", "Automations"],
            ["history", "History"],
          ].map(([icon, label]) => (
            <button key={icon} className="nav-item" disabled>
              <DashboardIcon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <section className="conversation-section" aria-label="Private conversations">
          <h2 className="section-label">Private</h2>
          <div className="empty-folder">Drop a chat here to make it private</div>
        </section>
        <section className="team-section">
          <h2 className="section-label">
            Team
            <Eye size={14} />
          </h2>
          <div className="empty-folder">Drop a chat here to share it</div>
        </section>
      </div>
      <div className="sidebar-footer">
        <Link to="/app/settings/account" className="nav-item" onClick={onNavigate}>
          <DashboardIcon name="settings" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
