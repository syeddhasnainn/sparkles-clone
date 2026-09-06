import { useCallback, useEffect, useRef, useState } from "react";
import { requestView } from "./view-client";
import type {
  WorkspaceServices,
  WorkspaceViewCommand,
} from "../../../bridge/workspace-view-contracts";

export function useWorkspaceService(taskId: string, service: "preview" | "desktop", path: string) {
  const [services, setServices] = useState<WorkspaceServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ url: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const currentPath = useRef(path);
  useEffect(() => {
    currentPath.current = path;
  }, [path]);
  const connecting = useRef(false);
  const status = services?.[service].status;

  useEffect(() => {
    mounted.current = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await requestView(taskId, { kind: "services" });
        if (mounted.current && next.kind === "services") setServices(next);
      } catch (error) {
        if (mounted.current)
          setError(error instanceof Error ? error.message : "Could not load the workspace.");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [taskId]);

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      const next = await requestView(taskId, {
        kind: "connect",
        service,
        path: currentPath.current,
      });
      if (mounted.current && next.kind === "connect") {
        setConnection(next);
        setError(null);
      }
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      connecting.current = false;
    }
  }, [taskId, service]);
  useEffect(() => {
    if (status !== "ready") return;
    void connect();
    const renew = setInterval(() => void connect(), 12 * 60 * 1000);
    return () => clearInterval(renew);
  }, [status, connect]);

  const run = async (action: WorkspaceViewCommand) => {
    setPending(true);
    setError(null);
    try {
      const next = await requestView(taskId, action);
      if (mounted.current && next.kind === "services") setServices(next);
      if (action.kind === "preview-stop") setConnection(null);
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : "The service could not start.");
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return { services, error, setError, connection, pending, status, connect, run };
}
