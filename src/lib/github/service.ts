import { redirect } from "@tanstack/react-router";
import { z } from "zod";
import { decrypt, encrypt } from "./crypto";
import { GitHubError } from "./api.server";
import type { exchangeToken, requestGitHub, revokeToken } from "./api.server";
import type { GitHubStore } from "./store";

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  appSlug: string;
  redirectUri: string;
  encryptionKey: string;
}

interface GitHubSession {
  user: { id: string } | null;
  sessionId?: string;
}

export interface GitHubDependencies {
  config: GitHubConfig;
  store: GitHubStore;
  getAuth: () => Promise<GitHubSession>;
  exchangeToken: typeof exchangeToken;
  requestGitHub: typeof requestGitHub;
  revokeToken: typeof revokeToken;
}

const credentialsSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });

export function createGitHubService({
  config,
  store,
  getAuth,
  exchangeToken,
  requestGitHub,
  revokeToken,
}: GitHubDependencies) {
  const {
    deleteConnection,
    lockConnection,
    readConnection,
    refreshConnection,
    requireReconnect,
    unlockConnection,
  } = store;

  async function requireGitHubUser() {
    const auth = await getAuth();

    if (!auth.user || !auth.sessionId) {
      throw redirect({ to: "/sign-in", search: { returnTo: "/app/settings/integrations" } });
    }

    return { userId: auth.user.id, sessionId: auth.sessionId };
  }

  function githubConfigured(): boolean {
    return Boolean(
      config.clientId &&
      config.clientSecret &&
      config.appSlug &&
      config.redirectUri &&
      /^[a-f\d]{64}$/i.test(config.encryptionKey ?? ""),
    );
  }

  function installationUrl(): string | null {
    return githubConfigured()
      ? `https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`
      : null;
  }

  async function encryptCredentials(userId: string, accessToken: string, refreshToken: string) {
    return encrypt(
      JSON.stringify({ accessToken, refreshToken }),
      config.encryptionKey,
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
        await decrypt(row.credentials, config.encryptionKey, `github:connection:${userId}`),
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
      const tokens = await exchangeToken(config.clientId, config.clientSecret, {
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

  async function githubRequest<T>(userId: string, path: string, schema: z.ZodType<T>): Promise<T> {
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

  async function disconnectGitHub(userId: string): Promise<void> {
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
          await decrypt(row.credentials, config.encryptionKey, `github:connection:${userId}`),
        ),
      );
      let token = credentials.accessToken;

      if (row.expires_at <= Date.now() + 60_000) {
        if (row.refresh_expires_at <= Date.now()) {
          await deleteConnection(row, lockId);

          return;
        }

        try {
          const tokens = await exchangeToken(config.clientId, config.clientSecret, {
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

      await revokeToken(config.clientId, config.clientSecret, token);
      await deleteConnection(row, lockId);
    } finally {
      await unlockConnection(row, lockId);
    }
  }

  return {
    requireGitHubUser,
    githubConfigured,
    installationUrl,
    encryptCredentials,
    githubRequest,
    disconnectGitHub,
  };
}
