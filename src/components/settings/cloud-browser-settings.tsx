import { Trash2 } from "lucide-react";
import { SettingsSection } from "./settings-section";

export function CloudBrowserSettings() {
  return (
    <SettingsSection
      title="Cloud browser"
      description="Logins inside the in-app cloud browser are saved per project so you don't sign in again every session."
    >
      <div className="settings-action-panel">
        <p>No saved cloud-browser sessions.</p>
        <button className="settings-button" disabled>
          <Trash2 size={16} />
          Clear saved sessions
        </button>
      </div>
    </SettingsSection>
  );
}
