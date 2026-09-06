import { z } from "zod";
import type { Events, Agent } from "./task-types";

function pendingPermissions(events: Events) {
  const permissions = new Map<unknown, Events[number]>();
  for (const event of events) {
    if (event.type === "permission") permissions.set(event.data.id, event);
    if (["interrupted", "workspace_stopped", "restored"].includes(event.type)) permissions.clear();
    if (event.type === "permission_resolved") permissions.delete(event.data.id);
  }
  return [...permissions.values()];
}

function permissionDetails(permission: Events[number]) {
  // Show the actual approval request, never mutable updates from another call or turn.
  return z.record(z.string(), z.unknown()).parse(permission.data.toolCall);
}

export function Permissions({ agent }: { agent: Agent }) {
  return pendingPermissions(agent.events).map((event) => (
    <div className="task-permission" key={event.id}>
      <strong>OpenCode needs permission</strong>
      <p>{String(permissionDetails(event).title || "Tool request")}</p>
      <pre>{JSON.stringify(permissionDetails(event).rawInput || {}, null, 2)}</pre>
      {z
        .array(z.object({ optionId: z.string(), name: z.string() }))
        .parse(event.data.options)
        .map((option) => (
          <button
            type="button"
            disabled={agent.sending}
            key={option.optionId}
            onClick={() =>
              void agent.send({
                kind: "permission",
                id: String(event.data.id),
                optionId: option.optionId,
              })
            }
          >
            {option.name}
          </button>
        ))}
    </div>
  ));
}
