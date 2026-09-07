import type { z } from "zod";
import type { modelGatewaySchema } from "./contracts.ts";

interface OpenCodeProviderConfig {
  options: { baseURL: string; apiKey: string };
  models?: Record<
    string,
    {
      name: string;
      reasoning: boolean;
      options: { reasoningEffort: string };
      tool_call: boolean;
      limit: { context: number; output: number };
    }
  >;
}

// Repository configuration cannot override the hosted agent's credentials or permissions.
export function createAgentEnvironment(gateway: z.infer<typeof modelGatewaySchema>) {
  const agent = gateway.agent ?? "opencode";
  const common = {
    SPARKLES_AGENT: agent,
    SPARKLES_MODEL_GATEWAY_TOKEN: gateway.token,
    SPARKLES_MODEL_GATEWAY_URL: gateway.url,
  };
  if (agent === "codex") {
    return {
      ...common,
      NO_BROWSER: "1",
      CODEX_PATH: "/usr/local/bin/codex",
      INITIAL_AGENT_MODE: gateway.permissionMode ?? "read-only",
      CODEX_CONFIG: JSON.stringify({
        model: gateway.model.replace(/^openai\//, ""),
        model_reasoning_effort: gateway.reasoningEffort ?? "medium",
        approval_policy: "on-request",
        sandbox_mode: "read-only",
        web_search: "disabled",
        features: { shell_snapshot: false },
      }),
    };
  }
  const provider = gateway.provider === "chatgpt" ? "openai" : "openrouter";
  const providerConfig: OpenCodeProviderConfig = {
    options: { baseURL: gateway.url, apiKey: "{env:SPARKLES_MODEL_GATEWAY_TOKEN}" },
  };
  if (gateway.provider === "chatgpt") {
    const modelId = gateway.model.replace(/^openai\//, "");
    const context = gateway.contextWindow ?? 128000;
    providerConfig.models = {
      [modelId]: {
        name: modelId,
        reasoning: true,
        options: { reasoningEffort: gateway.reasoningEffort ?? "medium" },
        tool_call: true,
        limit: { context, output: Math.min(16384, Math.floor(context / 2)) },
      },
    };
  }
  return {
    ...common,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_PERMISSION: JSON.stringify({ "*": "ask" }),
    XDG_CONFIG_HOME: "/opt/sparkles/config",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: gateway.model,
      small_model: gateway.model,
      enabled_providers: [provider],
      provider: { [provider]: providerConfig },
      permission: "ask",
      share: "disabled",
      autoupdate: false,
    }),
  };
}
