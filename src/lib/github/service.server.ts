import { env } from "cloudflare:workers";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { redirect } from "@tanstack/react-router";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto";
import { exchangeToken, GitHubError, requestGitHub, revokeToken } from "./api.server";
import {
  deleteConnection,
  lockConnection,
  readConnection,
  refreshConnection,
  requireReconnect,
  unlockConnection,
} from "./store.server";

const credentialsSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });

export async function requireGitHubUser() {
  const auth = await getAuth();

  if (!auth.user || !auth.sessionId) {
    throw redirect({ to: "/sign-in", search: { returnTo: "/app/settings/integrations" } });
  }

  return { userId: auth.user.id, sessionId: auth.sessionId };
}

export function githubConfigured(): boolean {
  return Boolean(
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_REDIRECT_URI &&
    /^[a-f\d]{64}$/i.test(env.GITHUB_TOKEN_ENCRYPTION_KEY ?? ""),
  );
}

export function installationUrl(): string | null {
  return githubConfigured()
    ? `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}/installations/new`
    : null;
}

export async function encryptCredentials(
  userId: string,
  accessToken: string,
  refreshToken: string,
) {
  return encrypt(
    JSON.stringify({ accessToken, refreshToken }),
    env.GITHUB_TOKEN_ENCRYPTION_KEY,
    `github:connection:${userId}`,
  );
}

async function getToken(userId: string, forceRefresh = false): Promise<string> {
  const row = await readConnection(userId);

  if (!row || row.reconnect_required || row.refresh_expires_at <= Date.now()) {
    throw new GitHubError(401);
  }

  if (row.lock_expires_at > Date.now()) {
    throw new Error("Your GitHub connection is updating. Try again in a moment.");
  }

  const credentials = credentialsSchema.parse(
    JSON.parse(
      await decrypt(
        row.credentials,
        env.GITHUB_TOKEN_ENCRYPTION_KEY,
        `github:connection:${userId}`,
      ),
    ),
  );

  if (!forceRefresh && row.expires_at > Date.now() + 60_000) {
    return credentials.accessToken;
  }

  const lockId = crypto.randomUUID();

  if (!(await lockConnection(row, lockId))) {
    throw new Error("Your GitHub connection is updating. Try again in a moment.");
  }

  try {
    const tokens = await exchangeToken(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, {
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });

    const saved = await refreshConnection(
      row,
      lockId,
      await encryptCredentials(userId, tokens.access_token, tokens.refresh_token),
      Date.now() + tokens.expires_in * 1000,
      Date.now() + tokens.refresh_token_expires_in * 1000,
    );

    if (!saved) {
      throw new Error("Your GitHub connection changed. Please try again.");
    }

    return tokens.access_token;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      await requireReconnect(row);
    }

    throw error;
  } finally {
    await unlockConnection(row, lockId);
  }
}

export async function githubRequest<T>(
  userId: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return await requestGitHub(await getToken(userId), path, schema);
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 401) {
      throw error;
    }
  }

  try {
    return await requestGitHub(await getToken(userId, true), path, schema);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      const row = await readConnection(userId);

      if (row) {
        await requireReconnect(row);
      }
    }

    throw error;
  }
}

export async function disconnectGitHub(userId: string): Promise<void> {
  const row = await readConnection(userId);

  if (!row) {
    return;
  }

  const lockId = crypto.randomUUID();

  if (!(await lockConnection(row, lockId))) {
    throw new Error("Your GitHub connection is updating. Try again in a moment.");
  }

  try {
    const credentials = credentialsSchema.parse(
      JSON.parse(
        await decrypt(
          row.credentials,
          env.GITHUB_TOKEN_ENCRYPTION_KEY,
          `github:connection:${userId}`,
        ),
      ),
    );
    let token = credentials.accessToken;

    if (row.expires_at <= Date.now() + 60_000) {
      if (row.refresh_expires_at <= Date.now()) {
        await deleteConnection(row, lockId);

        return;
      }

      try {
        const tokens = await exchangeToken(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, {
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
        });

        const saved = await refreshConnection(
          row,
          lockId,
          await encryptCredentials(userId, tokens.access_token, tokens.refresh_token),
          Date.now() + tokens.expires_in * 1000,
          Date.now() + tokens.refresh_token_expires_in * 1000,
        );

        if (!saved) {
          throw new Error("Your GitHub connection changed. Please try again.");
        }

        token = tokens.access_token;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 401) {
          await deleteConnection(row, lockId);

          return;
        }

        throw error;
      }
    }

    await revokeToken(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, token);
    await deleteConnection(row, lockId);
  } finally {
    await unlockConnection(row, lockId);
  }
}
