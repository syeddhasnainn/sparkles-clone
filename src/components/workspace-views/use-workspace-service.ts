import { useCallback, useEffect, useRef, useReducer } from "react";
import type { requestView as RequestView } from "./view-client";
import { isolatedWorkspaceUrl } from "./workspace-view-url";
import type {
  WorkspaceServices,
  WorkspaceViewCommand,
} from "../../../bridge/workspace-view-contracts";

interface ServiceState {
  services: WorkspaceServices | null;
  error: string | null;
  connection: { url: string; expiresAt: number } | null;
  pending: boolean;
}
const initialState: ServiceState = {
  services: null,
  error: null,
  connection: null,
  pending: false,
};

export function useWorkspaceService(
  taskId: string,
  service: "preview" | "desktop",
  path: string,
  requestView: typeof RequestView,
  autoStartDesktop = false,
) {
  const [{ services, error, connection, pending }, update] = useReducer(
    (state: ServiceState, changes: Partial<ServiceState>) => ({ ...state, ...changes }),
    initialState,
  );
  const setError = (error: string | null) => update({ error });
  const generation = useRef(0);
  const currentPath = useRef(path);
  useEffect(() => {
    currentPath.current = path;
  }, [path]);
  const connecting = useRef(false);
  const status = services?.[service].status;

  useEffect(() => {
    const current = ++generation.current;
    update(initialState);
    connecting.current = false;
    let loading = false;
    const refresh = (initial = false) => {
      if (loading) return;
      loading = true;
      void requestView(taskId, { kind: "services" })
        .then((next) => {
          if (generation.current !== current || next.kind !== "services") return;
          update({ services: next, error: null });
          if (
            initial &&
            service === "desktop" &&
            autoStartDesktop &&
            next.desktop.status === "stopped"
          ) {
            return requestView(taskId, { kind: "desktop-start" }).then((started) => {
              if (generation.current === current && started.kind === "services")
                update({ services: started });
            });
          }
        })
        .catch((error) => {
          if (generation.current === current)
            update({
              error: error instanceof Error ? error.message : "Could not load the workspace.",
            });
        })
        .finally(() => {
          loading = false;
        });
    };
    void refresh(true);
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      generation.current++;
      clearInterval(interval);
    };
  }, [taskId, service, requestView, autoStartDesktop]);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    const current = generation.current;
    try {
      const next = await requestView(taskId, {
        kind: "connect",
        service,
        path: currentPath.current,
      });
      if (generation.current === current && next.kind === "connect") {
        update({
          connection: { ...next, url: isolatedWorkspaceUrl(next.url, window.location.origin) },
          error: null,
        });
      }
    } catch (error) {
      if (generation.current === current)
        update({ error: error instanceof Error ? error.message : "Could not connect." });
    } finally {
      if (generation.current === current) connecting.current = false;
    }
  }, [taskId, service, requestView]);
  useEffect(() => {
    if (status !== "ready") return;
    void connect();
    const renew = setInterval(() => void connect(), 12 * 60 * 1000);
    return () => clearInterval(renew);
  }, [status, connect]);

  const run = async (action: WorkspaceViewCommand) => {
    const current = generation.current;
    update({ pending: true, error: null });
    try {
      const next = await requestView(taskId, action);
      if (generation.current !== current) return;
      const changes: Partial<ServiceState> = {};
      if (next.kind === "services") changes.services = next;
      if (action.kind === "preview-stop") changes.connection = null;
      update(changes);
    } catch (error) {
      if (generation.current === current)
        update({ error: error instanceof Error ? error.message : "The service could not start." });
    } finally {
      if (generation.current === current) update({ pending: false });
    }
  };
  return { services, error, setError, connection, pending, status, connect, run };
}
