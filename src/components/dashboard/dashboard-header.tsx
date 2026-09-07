import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import type { RefObject } from "react";
import { DashboardIcon } from "./dashboard-icon";

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
    <header className="dashboard-header" data-settings={settings || undefined}>
      <Tooltip>
        <TooltipTrigger
          ref={toggleRef}
          className={`icon-button header-sidebar-toggle ${sidebarOpen ? "mobile-only" : ""}`}
          onClick={onToggle}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarOpen}
          aria-controls="dashboard-sidebar"
        >
          <DashboardIcon name="sidebar" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        </TooltipContent>
      </Tooltip>
      <div className="dashboard-title-slot" ref={contentRef} />
    </header>
  );
}
