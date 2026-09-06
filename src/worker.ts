import server from "@tanstack/react-start/server-entry";
import { modelGateway } from "./lib/workspaces/model-gateway";
import { Container } from "@cloudflare/containers";

export { WorkspaceManager } from "./lib/workspaces/manager";

export class ModalBridge extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  envVars = {
    MODAL_TOKEN_ID: this.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: this.env.MODAL_TOKEN_SECRET,
    MODAL_APP_NAME: this.env.MODAL_APP_NAME,
  };
}

export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith("/api/model/"))
      return modelGateway(request, env).catch(() =>
        Response.json({ error: { message: "Model gateway unavailable" } }, { status: 503 }),
      );
    return server.fetch(request);
  },
};
