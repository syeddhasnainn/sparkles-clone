import { useCallback, useEffect, useRef, useState } from "react";
import { listWorkspaces, stopWorkspace, resumeWorkspace } from "../lib/workspaces/functions";

export function useWorkspaces() {
  const [data, setData] = useState<Awaited<ReturnType<typeof listWorkspaces>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setData(await listWorkspaces());
      setError(null);
    } catch {
      setError("Could not load workspaces. Retrying shortly.");
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const stop = async (id: string) => {
    try {
      await stopWorkspace({ data: { id } });
      await refresh();
    } catch {
      setError("Could not stop the workspace. Please try again.");
    }
  };

  const resume = async (id: string) => {
    try {
      await resumeWorkspace({ data: { id } });
      await refresh();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not restore the workspace. Please try again.",
      );
      return false;
    }
  };
  return { data, error, refresh, stop, resume };
}
