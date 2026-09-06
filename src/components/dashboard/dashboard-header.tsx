import type { RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { DashboardIcon } from "./dashboard-icon";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AccountAvatar } from "./account-avatar";

interface DashboardHeaderProps {
  sidebarOpen: boolean;
  onToggle: () => void;
  settings: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

export function DashboardHeader({
  sidebarOpen,
  onToggle,
  settings,
  toggleRef,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <button
        ref={toggleRef}
        className={`icon-button header-sidebar-toggle ${sidebarOpen ? "mobile-only" : ""}`}
        onClick={onToggle}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={sidebarOpen}
        aria-controls="dashboard-sidebar"
      >
        <DashboardIcon name="sidebar" />
      </button>
      {!settings && <WorkspaceSwitcher />}
      <Link className="account-link" to="/app/settings/account" aria-label="Account">
        <AccountAvatar />
      </Link>
    </header>
  );
}
