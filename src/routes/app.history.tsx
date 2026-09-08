import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "@/components/dashboard/history-page";

export const Route = createFileRoute("/app/history")({
  head: () => ({ meta: [{ title: "History — Sparkles" }] }),
  component: HistoryPage,
});
