import type { useTaskAgent } from "@/hooks/use-task-agent";
import type { AgentSnapshot } from "../../../bridge/contracts";
export type Agent = ReturnType<typeof useTaskAgent>;
export type Events = AgentSnapshot["events"];
