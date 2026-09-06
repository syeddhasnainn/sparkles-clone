import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { DashboardIcon } from "@/components/dashboard/dashboard-icon";
import { WorkspaceSwitcher } from "@/components/dashboard/workspace-switcher";

export function SettingsSidebar({
  onToggle,
  onNavigate,
}: {
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <aside
      className="dashboard-sidebar settings-sidebar"
      id="dashboard-sidebar"
      aria-label="Settings sidebar"
    >
      <div className="settings-sidebar-header">
        <WorkspaceSwitcher />
        <button className="icon-button" aria-label="Collapse settings sidebar" onClick={onToggle}>
          <DashboardIcon name="sidebar" />
        </button>
      </div>
      <nav className="settings-navigation" aria-label="Settings">
        <section>
          <h2>You</h2>
          <Link
            to="/app/settings/account"
            className="settings-nav-link"
            activeProps={{ className: "active" }}
            onClick={onNavigate}
          >
            Account
          </Link>
          <Link
            to="/app/settings/memories"
            className="settings-nav-link"
            activeProps={{ className: "active" }}
            onClick={onNavigate}
          >
            Memories
          </Link>
          <Link
            to="/app/settings/integrations"
            className="settings-nav-link"
            activeProps={{ className: "active" }}
            onClick={onNavigate}
          >
            Integrations
          </Link>
          <span className="settings-nav-link" aria-disabled="true">
            API
          </span>
        </section>
        <section>
          <h2>Organization</h2>
          {["General", "Billing"].map((label) => (
            <span key={label} className="settings-nav-link" aria-disabled="true">
              {label}
            </span>
          ))}
        </section>
      </nav>
      <div className="sidebar-footer">
        <Link to="/app" className="nav-item" onClick={onNavigate}>
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>
      </div>
    </aside>
  );
}
