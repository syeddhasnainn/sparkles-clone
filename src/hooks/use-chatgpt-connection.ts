import { useCallback, useEffect, useState } from "react";
import { getChatGPTConnection } from "../lib/chatgpt/functions";

export function useChatGPTConnection() {
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof getChatGPTConnection>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setConnection(await getChatGPTConnection());
      setError(null);
    } catch {
      setError("Could not load the ChatGPT connection.");
    }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload]);
  return { connection, error, reload };
}
