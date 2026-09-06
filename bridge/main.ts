import { createBridgeServer } from "./server.ts";
import { ModalProvider } from "./modal-provider.ts";

createBridgeServer(new ModalProvider(process.env.MODAL_APP_NAME || "sparkles-workspaces")).listen(
  8080,
  "0.0.0.0",
);
