import { useEffect, useState } from "react";
import { AppIcon } from "../ui/app-icon";
import Trash2 from "@hugeicons/core-free-icons/Delete02Icon";
import { SettingsSection } from "./settings-section";
import { clearCloudBrowserSessions, getCloudBrowserSessions } from "@/lib/workspaces/functions";

export function CloudBrowserSettings() {
  const [sessions, setSessions] = useState<Awaited<
    ReturnType<typeof getCloudBrowserSessions>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCloudBrowserSessions()
      .then((result) => {
        if (!cancelled) setSessions(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load saved cloud-browser sessions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clear = async () => {
    setClearing(true);
    setError(null);
    setMessage(null);
    try {
      await clearCloudBrowserSessions();
      setSessions({ count: 0, updatedAt: null, cleanupPending: false, projects: [] });
      setMessage(
        "Saved browser data was cleared. This does not sign you out from websites on other devices.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message.includes("running cloud browser")
          ? caught.message
          : "Could not reset every cloud browser. Retry clearing before using a running browser.",
      );
    } finally {
      setClearing(false);
    }
  };

  const status = loading
    ? "Loading saved browser data…"
    : sessions?.count
      ? `Saved browser data for ${sessions.count} project${sessions.count === 1 ? "" : "s"}.`
      : "No saved cloud-browser sessions.";

  return (
    <SettingsSection
      title="Cloud browser"
      description="Logins inside the in-app cloud browser are saved per project so you don't sign in again every session."
    >
      <div className="settings-action-panel">
        <p role="status">{status}</p>
        <button
          className="settings-button"
          disabled={loading || clearing}
          onClick={() => void clear()}
        >
          <AppIcon icon={Trash2} size={16} />
          {clearing ? "Clearing…" : "Clear saved sessions"}
        </button>
      </div>
      {error && (
        <p className="settings-status text-destructive" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="settings-status" role="status">
          {message}
        </p>
      )}
    </SettingsSection>
  );
}
