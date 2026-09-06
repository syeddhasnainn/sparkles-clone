import { defineConfig, loadEnv } from "vite";
import type { ViteDevServer } from "vite";
import { z } from "zod";
import { startLocalModelGateway } from "./bridge/local-model-gateway.ts";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(async ({ command, mode, isPreview }) => {
  const local = command === "serve" && !isPreview;
  const variables: Record<string, string> = {};
  let closeBridge = () => {};

  if (local) {
    const [{ createBridgeServer }, { ModalProvider }] = await Promise.all([
      import("./bridge/server.ts"),
      import("./bridge/modal-provider.ts"),
    ]);
    const settings = loadEnv(mode, process.cwd(), "");
    const provider = new ModalProvider(settings.MODAL_APP_NAME || "sparkles-workspaces", {
      tokenId: settings.MODAL_TOKEN_ID,
      tokenSecret: settings.MODAL_TOKEN_SECRET,
    });
    const gateway = settings.MODEL_GATEWAY_URL ? undefined : await startLocalModelGateway();
    variables.MODEL_GATEWAY_URL = settings.MODEL_GATEWAY_URL || gateway?.url || "";
    const token = crypto.randomUUID();
    const bridge = createBridgeServer(provider, token);
    await new Promise<void>((resolve, reject) => {
      bridge.once("error", reject);
      bridge.listen(0, "127.0.0.1", resolve);
    });
    const address = z.object({ port: z.number() }).parse(bridge.address());
    variables.LOCAL_MODAL_BRIDGE_URL = `http://127.0.0.1:${address.port}`;
    variables.LOCAL_MODAL_BRIDGE_TOKEN = token;
    closeBridge = () => {
      gateway?.close();
      bridge.closeAllConnections();
      bridge.close();
      provider.close();
    };
  }

  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      {
        name: "sparkles-local-bridge",
        configureServer(server: ViteDevServer) {
          server.httpServer?.once("close", closeBridge);
        },
      },
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config: (config) => ({ vars: { ...config.vars, ...variables } }),
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  };
});
