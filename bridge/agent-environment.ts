// The repository is task input, not configuration authority for the hosted agent.
export function createAgentEnvironment(gateway: { url: string; token: string; model: string }) {
  return {
    SPARKLES_MODEL_GATEWAY_TOKEN: gateway.token,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_PERMISSION: JSON.stringify({ "*": "ask" }),
    XDG_CONFIG_HOME: "/opt/sparkles/config",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: gateway.model,
      small_model: gateway.model,
      enabled_providers: ["openrouter"],
      provider: {
        openrouter: {
          options: { baseURL: gateway.url, apiKey: "{env:SPARKLES_MODEL_GATEWAY_TOKEN}" },
        },
      },
      permission: "ask",
      share: "disabled",
      autoupdate: false,
    }),
  };
}
