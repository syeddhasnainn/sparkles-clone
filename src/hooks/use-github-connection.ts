import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getGitHubConnection, type GitHubConnection } from "@/lib/github/functions";

export function useGitHubConnection() {
  const getConnection = useServerFn(getGitHubConnection);
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);

    try {
      setConnection(await getConnection());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getConnection]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { connection, loading, error, reload };
}
