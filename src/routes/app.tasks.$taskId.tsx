import { createFileRoute } from "@tanstack/react-router";
import { TaskPage } from "@/components/tasks/task-page";
export const Route = createFileRoute("/app/tasks/$taskId")({ component: TaskRoute });
function TaskRoute() {
  const { taskId } = Route.useParams();
  return <TaskPage key={taskId} taskId={taskId} />;
}
