import { workspaceViewCommand } from "../../lib/workspaces/functions";
import { workspaceViewResultSchema } from "../../../bridge/workspace-view-contracts";
import type { WorkspaceViewCommand } from "../../../bridge/workspace-view-contracts";

export async function requestView(id: string, command: WorkspaceViewCommand) {
  const result = workspaceViewResultSchema.parse(
    JSON.parse(await workspaceViewCommand({ data: { id, command } })),
  );
  if (result.kind === "error") throw new Error(result.message);
  return result;
}
