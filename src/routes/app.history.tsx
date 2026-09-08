import { createFileRoute } from "@tanstack/react-router";
import { ThreadHistory } from "@/components/dashboard/thread-history";

export const Route = createFileRoute("/app/history")({
  head: () => ({ meta: [{ title: "History — Sparkles" }] }),
  component: ThreadHistory,
});
