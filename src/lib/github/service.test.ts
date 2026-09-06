import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { encrypt } from "./crypto";
import { GitHubError } from "./api.server";
import { createGitHubService, type GitHubDependencies } from "./service";
import type { GitHubStore } from "./store";

const store = {
  readConnection: vi.fn<GitHubStore["readConnection"]>(),
  saveConnection: vi.fn<GitHubStore["saveConnection"]>(),
  lockConnection: vi.fn<GitHubStore["lockConnection"]>(),
  unlockConnection: vi.fn<GitHubStore["unlockConnection"]>(),
  refreshConnection: vi.fn<GitHubStore["refreshConnection"]>(),
  requireReconnect: vi.fn<GitHubStore["requireReconnect"]>(),
  deleteConnection: vi.fn<GitHubStore["deleteConnection"]>(),
  saveOAuthState: vi.fn<GitHubStore["saveOAuthState"]>(),
  consumeOAuthState: vi.fn<GitHubStore["consumeOAuthState"]>(),
};

const {
  readConnection,
  lockConnection,
  refreshConnection,
  requireReconnect,
  unlockConnection,
  deleteConnection,
} = store;
const getAuth = vi.fn<GitHubDependencies["getAuth"]>();
const exchangeToken = vi.fn<GitHubDependencies["exchangeToken"]>();
const requestGitHub = vi.fn<GitHubDependencies["requestGitHub"]>();
const revokeToken = vi.fn<GitHubDependencies["revokeToken"]>();

const { requireGitHubUser, githubRequest, disconnectGitHub } = createGitHubService({
  config: {
    encryptionKey: "ad".repeat(32),
    clientId: "client",
    clientSecret: "secret",
    appSlug: "sparkles-demo",
    redirectUri: "http://localhost:3000/api/github/callback",
  },
  store,
  getAuth,
  exchangeToken,
  requestGitHub: async (token, path, schema) =>
    schema.parse(await requestGitHub(token, path, schema)),
  revokeToken,
});

beforeEach(async () => {
  vi.resetAllMocks();
  readConnection.mockResolvedValue({
    user_id: "user-a",
    connection_id: "connection-a",
    github_user_id: 1,
    login: "octocat",
    avatar_url: "https://github.com/avatar.png",
    credentials: await encrypt(
      JSON.stringify({ accessToken: "old-token", refreshToken: "refresh-token" }),
      "ad".repeat(32),
      "github:connection:user-a",
    ),
    expires_at: Date.now() - 1000,
    refresh_expires_at: Date.now() + 86_400_000,
    reconnect_required: 0,
    lock_id: null,
    lock_expires_at: 0,
    connected_at: Date.now(),
  });
  lockConnection.mockResolvedValue(true);
  refreshConnection.mockResolvedValue(true);
  exchangeToken.mockResolvedValue({
    access_token: "new-token",
    refresh_token: "new-refresh",
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
  });
  requestGitHub.mockResolvedValue({ ok: true });
});

describe("GitHub session and refresh boundaries", () => {
  it("rejects unauthenticated access before using a GitHub connection", async () => {
    getAuth.mockResolvedValue({ user: null });

    await expect(requireGitHubUser()).rejects.toBeDefined();
    expect(readConnection).not.toHaveBeenCalled();
  });

  it("refreshes expired credentials under a database lock", async () => {
    await githubRequest("user-a", "/user/installations", z.object({ ok: z.boolean() }));

    expect(readConnection).toHaveBeenCalledWith("user-a");
    expect(exchangeToken).toHaveBeenCalledWith("client", "secret", {
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
    });
    expect(requestGitHub).toHaveBeenCalledWith(
      "new-token",
      "/user/installations",
      expect.anything(),
    );
    expect(unlockConnection).toHaveBeenCalledOnce();
  });

  it("does not rotate a refresh token while another request holds the lock", async () => {
    lockConnection.mockResolvedValue(false);

    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow("updating");
    expect(exchangeToken).not.toHaveBeenCalled();
    expect(requestGitHub).not.toHaveBeenCalled();
  });

  it("does not use a token after a concurrent connection replacement", async () => {
    refreshConnection.mockResolvedValue(false);

    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow("changed");
    expect(requestGitHub).not.toHaveBeenCalled();
  });

  it("preserves the connection on a transient token service failure", async () => {
    exchangeToken.mockRejectedValue(new GitHubError(503));

    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow();
    expect(requireReconnect).not.toHaveBeenCalled();
    expect(unlockConnection).toHaveBeenCalledOnce();
  });

  it("retains local credentials when GitHub revocation fails so disconnect can be retried", async () => {
    revokeToken.mockRejectedValue(new GitHubError(503));

    await expect(disconnectGitHub("user-a")).rejects.toThrow();
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(unlockConnection).toHaveBeenCalledOnce();
  });
});
