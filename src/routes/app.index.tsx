import { createFileRoute } from "@tanstack/react-router";
import { useDashboardDraft } from "@/components/dashboard/dashboard-draft";
import { TaskComposer } from "@/components/dashboard/task-composer";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "New chat — Sparkles" }] }),
  component: DashboardHome,
});

function DashboardHome() {
  const draft = useDashboardDraft();
  return (
    <div className="dashboard-workspace">
      <TaskComposer key={draft} />
    </div>
  );
}
