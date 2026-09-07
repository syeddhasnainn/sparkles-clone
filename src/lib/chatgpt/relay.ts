export type ChatGPTRelayEnvironment = Partial<Pick<Env, "MODAL_BRIDGE">> & {
  LOCAL_MODAL_BRIDGE_URL?: string;
  LOCAL_MODAL_BRIDGE_TOKEN?: string;
};

export async function relayChatGPT(environment: ChatGPTRelayEnvironment, options: RequestInit) {
  const headers = new Headers(options.headers);
  headers.set("X-Sparkles-ChatGPT-Authorization", headers.get("Authorization") || "");
  headers.delete("Authorization");
  const localUrl = import.meta.env.DEV ? environment.LOCAL_MODAL_BRIDGE_URL : undefined;

  if (localUrl) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(localUrl) || !environment.LOCAL_MODAL_BRIDGE_TOKEN)
      throw new Error("Invalid local bridge configuration.");
    headers.set("Authorization", `Bearer ${environment.LOCAL_MODAL_BRIDGE_TOKEN}`);
    return fetch(`${localUrl}/chatgpt/responses`, { ...options, headers });
  }

  if (!environment.MODAL_BRIDGE) throw new Error("ChatGPT relay unavailable.");
  return environment.MODAL_BRIDGE.getByName("bridge-0").fetch("http://bridge/chatgpt/responses", {
    ...options,
    headers,
  });
}
