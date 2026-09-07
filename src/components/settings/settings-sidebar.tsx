import { Link } from "@tanstack/react-router";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import { AppIcon } from "../ui/app-icon";

export function SettingsSidebar({ onNavigate }: { onNavigate: () => void }) {
  return (
    <aside
      className="dashboard-sidebar settings-sidebar"
      id="dashboard-sidebar"
      aria-label="Settings sidebar"
    >
      <div className="settings-sidebar-header">
        <Link
          to="/app"
          className="settings-nav-link settings-back-link"
          activeOptions={{ exact: true }}
          onClick={onNavigate}
        >
          <AppIcon icon={ArrowLeft} size={14} aria-hidden="true" />
          Back to dashboard
        </Link>
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
    </aside>
  );
}
