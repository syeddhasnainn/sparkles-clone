// OpenAI Codex catalog, verified September 8, 2026; only models marked visible.
// https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json
import type { ReasoningEffort } from "../../../bridge/agent-selection";
export const bundledChatGPTModels: {
  id: string;
  name: string;
  contextWindow: number;
  reasoningEfforts: ReasoningEffort[];
}[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6-Astra",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6-Sol",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6-Terra",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6-Luna",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    contextWindow: 272000,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
];
