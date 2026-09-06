import { AppIcon } from "../ui/app-icon";
import ChevronsUpDown from "@hugeicons/core-free-icons/ArrowUpDownIcon";

export function WorkspaceSwitcher() {
  return (
    <div className="workspace-switcher">
      <button className="organization-button" aria-label="Personal workspace" disabled>
        P
      </button>
      <span className="header-divider">/</span>
      <button className="project-button" disabled>
        Projects
        <AppIcon icon={ChevronsUpDown} size={12} />
      </button>
    </div>
  );
}
