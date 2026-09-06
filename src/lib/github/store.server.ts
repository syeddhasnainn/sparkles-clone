import { env } from "cloudflare:workers";
import { createGitHubStore } from "./store";

export const githubStore = createGitHubStore(env.DB);

export const {
  readConnection,
  saveConnection,
  lockConnection,
  unlockConnection,
  refreshConnection,
  requireReconnect,
  deleteConnection,
  saveOAuthState,
  consumeOAuthState,
} = githubStore;
