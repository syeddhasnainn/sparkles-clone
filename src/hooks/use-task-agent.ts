import { agentCommand } from "../lib/workspaces/functions";
import { useAgentConversation } from "./use-agent-conversation";
import type { AgentSnapshot } from "../../bridge/contracts";

export function useTaskAgent(id: string, enabled: boolean, initialSnapshot?: AgentSnapshot) {
  return useAgentConversation(id, enabled, agentCommand, initialSnapshot);
}
