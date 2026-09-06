import { DashboardIcon } from "./dashboard-icon";

export function RepositoryPicker() {
  return (
    <button
      type="button"
      className="toolbar-button"
      disabled
      title="Connect GitHub to choose a repository. GitHub connections are coming soon."
    >
      <DashboardIcon name="github" />
      <span>Connect GitHub</span>
    </button>
  );
}
