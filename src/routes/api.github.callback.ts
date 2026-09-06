import { timingSafeEqual } from "node:crypto";
import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { deleteCookie, getCookie } from "@tanstack/react-start/server";
import { decrypt, sha256 } from "@/lib/github/crypto";
import { exchangeToken, profileSchema, requestGitHub } from "@/lib/github/api.server";
import { encryptCredentials, requireGitHubUser } from "@/lib/github/service.server";
import { consumeOAuthState, saveConnection } from "@/lib/github/store.server";

function result(status: "connected" | "cancelled" | "failed") {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/app/settings/integrations?github=${status}`,
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { userId, sessionId } = await requireGitHubUser();
        const parameters = new URL(request.url).searchParams;
        const state = parameters.get("state") ?? "";
        const cookie = getCookie("github-oauth-state") ?? "";
        deleteCookie("github-oauth-state", { path: "/api/github" });
        if (
          !/^[\w-]{43}$/.test(state) ||
          !/^[\w-]{43}$/.test(cookie) ||
          !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
        )
          return result("failed");
        const flow = await consumeOAuthState(await sha256(state), userId, sessionId);
        if (!flow) return result("failed");
        if (parameters.get("error") === "access_denied") return result("cancelled");
        const code = parameters.get("code");
        if (!code || code.length > 1024) return result("failed");
        try {
          const verifier = await decrypt(
            flow.verifier,
            env.GITHUB_TOKEN_ENCRYPTION_KEY,
            `github:oauth:${userId}:${sessionId}`,
          );
          const tokens = await exchangeToken(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, {
            code,
            code_verifier: verifier,
            redirect_uri: env.GITHUB_REDIRECT_URI,
          });
          const profile = await requestGitHub(tokens.access_token, "/user", profileSchema);
          await saveConnection({
            user_id: userId,
            connection_id: crypto.randomUUID(),
            github_user_id: profile.id,
            login: profile.login,
            avatar_url: profile.avatar_url,
            credentials: await encryptCredentials(
              userId,
              tokens.access_token,
              tokens.refresh_token,
            ),
            expires_at: Date.now() + tokens.expires_in * 1000,
            refresh_expires_at: Date.now() + tokens.refresh_token_expires_in * 1000,
            connected_at: Date.now(),
          });
          return result("connected");
        } catch {
          return result("failed");
        }
      },
    },
  },
});
