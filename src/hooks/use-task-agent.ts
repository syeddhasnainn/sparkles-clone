import { agentCommand } from "../lib/workspaces/functions";
import { useAgentConversation } from "./use-agent-conversation";

export function useTaskAgent(id: string, enabled: boolean) {
  return useAgentConversation(id, enabled, agentCommand);
}
