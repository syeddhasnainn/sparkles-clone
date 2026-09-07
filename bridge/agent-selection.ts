import { z } from "zod";
import { permissionModeSchema } from "./permission-modes.ts";

export const reasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const chatGPTModelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const agentSelectionSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("openrouter"), agent: z.literal("opencode") }),
  z.object({
    provider: z.literal("chatgpt"),
    agent: z.enum(["opencode", "codex"]),
    model: chatGPTModelIdSchema,
    reasoningEffort: reasoningEffortSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
  }),
]);

export type AgentSelection = z.infer<typeof agentSelectionSchema>;
export const defaultAgentSelection: AgentSelection = { provider: "openrouter", agent: "opencode" };
export const agentName = (agent?: string) => (agent === "codex" ? "Codex" : "OpenCode");
