import { env } from "cloudflare:workers";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { exchangeToken, requestGitHub, revokeToken } from "./api.server";
import { createGitHubService } from "./service";
import { githubStore } from "./store.server";

export const {
  requireGitHubUser,
  githubConfigured,
  installationUrl,
  encryptCredentials,
  githubRequest,
  disconnectGitHub,
} = createGitHubService({
  config: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    appSlug: env.GITHUB_APP_SLUG,
    redirectUri: env.GITHUB_REDIRECT_URI,
    encryptionKey: env.GITHUB_TOKEN_ENCRYPTION_KEY,
  },
  store: githubStore,
  getAuth,
  exchangeToken,
  requestGitHub,
  revokeToken,
});
