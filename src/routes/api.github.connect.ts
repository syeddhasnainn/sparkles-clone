import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { encrypt, randomSecret, sha256 } from "@/lib/github/crypto";
import { githubConfigured, requireGitHubUser } from "@/lib/github/service.server";
import { saveOAuthState } from "@/lib/github/store.server";

export const Route = createFileRoute("/api/github/connect")({
  server: {
    handlers: {
      GET: async () => {
        const { userId, sessionId } = await requireGitHubUser();
        if (!githubConfigured())
          return new Response(null, {
            status: 303,
            headers: {
              Location: "/app/settings/integrations?github=unavailable",
              "Cache-Control": "no-store",
            },
          });
        const state = randomSecret();
        const verifier = randomSecret();
        await saveOAuthState(
          await sha256(state),
          userId,
          sessionId,
          await encrypt(
            verifier,
            env.GITHUB_TOKEN_ENCRYPTION_KEY,
            `github:oauth:${userId}:${sessionId}`,
          ),
        );
        setCookie("github-oauth-state", state, {
          httpOnly: true,
          secure: new URL(env.GITHUB_REDIRECT_URI).protocol === "https:",
          sameSite: "lax",
          path: "/api/github",
          maxAge: 600,
        });
        const url = new URL("https://github.com/login/oauth/authorize");
        url.search = new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          redirect_uri: env.GITHUB_REDIRECT_URI,
          state,
          code_challenge: await sha256(verifier),
          code_challenge_method: "S256",
        }).toString();
        return new Response(null, {
          status: 307,
          headers: { Location: url.href, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
