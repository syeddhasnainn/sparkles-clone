import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "../../bridge/contracts";

export interface WorkspaceList {
  configured: boolean;
  workspaces: Workspace[];
}
export interface WorkspaceClient {
  list(): Promise<WorkspaceList>;
  stop(id: string): Promise<void>;
  resume(id: string): Promise<void>;
}
export const WorkspacesContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null);

export function useWorkspaces() {
  const workspaces = useContext(WorkspacesContext);
  if (!workspaces) throw new Error("Workspace data provider is missing.");
  return workspaces;
}

export function useWorkspaceState(initialData: WorkspaceList, client: WorkspaceClient) {
  const [state, setState] = useState({ seed: initialData, data: initialData });
  if (state.seed !== initialData) setState({ seed: initialData, data: initialData });
  const data = state.seed === initialData ? state.data : initialData;
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const latestSeed = useRef(initialData);
  latestSeed.current = initialData;

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const seed = latestSeed.current;
    try {
      const next = await client.list();
      if (seed !== latestSeed.current) return;
      setState((current) => ({ ...current, data: next }));
      setError(null);
    } catch {
      setError("Could not load workspaces. Retrying shortly.");
    } finally {
      loading.current = false;
    }
  }, [client]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const stop = async (id: string) => {
    try {
      await client.stop(id);
      await refresh();
    } catch {
      setError("Could not stop the workspace. Please try again.");
    }
  };

  const resume = async (id: string) => {
    try {
      await client.resume(id);
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
