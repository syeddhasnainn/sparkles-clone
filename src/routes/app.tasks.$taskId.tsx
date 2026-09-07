import { createFileRoute } from "@tanstack/react-router";
import { TaskPage } from "@/components/tasks/task-page";
import { getTaskConversation } from "@/lib/workspaces/functions";
import { agentSnapshotSchema } from "../../bridge/contracts";

export const Route = createFileRoute("/app/tasks/$taskId")({
  loader: async ({ params }) =>
    agentSnapshotSchema.parse(
      JSON.parse(await getTaskConversation({ data: { id: params.taskId } })),
    ),
  component: TaskRoute,
});
function TaskRoute() {
  const { taskId } = Route.useParams();
  const conversation = Route.useLoaderData();
  return <TaskPage key={taskId} taskId={taskId} initialConversation={conversation} />;
}
