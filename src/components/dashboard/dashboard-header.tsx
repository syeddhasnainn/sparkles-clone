import { createContext } from "react";
import type { RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { DashboardIcon } from "./dashboard-icon";
import { AccountAvatar } from "./account-avatar";

export const TaskHeaderContext = createContext<HTMLDivElement | null>(null);

interface DashboardHeaderProps {
  contentRef: (element: HTMLDivElement | null) => void;
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
  contentRef,
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
      <div className="dashboard-title-slot" ref={contentRef}>
        {!settings && <span className="dashboard-default-title">New chat</span>}
      </div>
      <Link className="account-link" to="/app/settings/account" aria-label="Account">
        <AccountAvatar />
      </Link>
    </header>
  );
}
