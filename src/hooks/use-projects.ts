import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects } from "../lib/projects/functions";

export function useProjects() {
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await listProjects();
      if (current !== generation.current) return;
      setProjects(result);
      setError(false);
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("sparkles:projects-changed", changed);
    return () => {
      generation.current++;
      window.removeEventListener("sparkles:projects-changed", changed);
    };
  }, [refresh]);
  return { projects, loading, error, refresh };
}
