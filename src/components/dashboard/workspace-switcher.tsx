import { ChevronsUpDown } from "lucide-react";

export function WorkspaceSwitcher() {
  return (
    <div className="workspace-switcher">
      <button className="organization-button" aria-label="Personal workspace" disabled>
        P
      </button>
      <span className="header-divider">/</span>
      <button className="project-button" disabled>
        Projects
        <ChevronsUpDown size={12} />
      </button>
    </div>
  );
}
