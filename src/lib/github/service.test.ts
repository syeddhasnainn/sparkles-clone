import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { encrypt } from "./crypto";

vi.mock("cloudflare:workers", () => ({
  env: {
    GITHUB_TOKEN_ENCRYPTION_KEY: "ad".repeat(32),
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "secret",
  },
}));
vi.mock("@workos/authkit-tanstack-react-start", () => ({ getAuth: vi.fn() }));
vi.mock("./store.server", () => ({
  readConnection: vi.fn(),
  lockConnection: vi.fn(),
  refreshConnection: vi.fn(),
  requireReconnect: vi.fn(),
  unlockConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("./api.server", async (original) => ({
  ...(await original<typeof import("./api.server")>()),
  requestGitHub: vi.fn(),
  exchangeToken: vi.fn(),
  revokeToken: vi.fn(),
}));

import { getAuth } from "@workos/authkit-tanstack-react-start";
import { exchangeToken, requestGitHub, revokeToken, GitHubError } from "./api.server";
import {
  readConnection,
  lockConnection,
  refreshConnection,
  requireReconnect,
  unlockConnection,
  deleteConnection,
} from "./store.server";
import { disconnectGitHub, githubRequest, requireGitHubUser } from "./service.server";

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(readConnection).mockResolvedValue({
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
  vi.mocked(lockConnection).mockResolvedValue(true);
  vi.mocked(refreshConnection).mockResolvedValue(true);
  vi.mocked(exchangeToken).mockResolvedValue({
    access_token: "new-token",
    refresh_token: "new-refresh",
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
  });
  vi.mocked(requestGitHub).mockResolvedValue({ ok: true });
});

describe("GitHub session and refresh boundaries", () => {
  it("rejects unauthenticated access before using a GitHub connection", async () => {
    vi.mocked(getAuth).mockResolvedValue({ user: null });
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
    vi.mocked(lockConnection).mockResolvedValue(false);
    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow("updating");
    expect(exchangeToken).not.toHaveBeenCalled();
    expect(requestGitHub).not.toHaveBeenCalled();
  });

  it("does not use a token after a concurrent connection replacement", async () => {
    vi.mocked(refreshConnection).mockResolvedValue(false);
    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow("changed");
    expect(requestGitHub).not.toHaveBeenCalled();
  });

  it("preserves the connection on a transient token service failure", async () => {
    vi.mocked(exchangeToken).mockRejectedValue(new GitHubError(503));
    await expect(githubRequest("user-a", "/user", z.unknown())).rejects.toThrow();
    expect(requireReconnect).not.toHaveBeenCalled();
    expect(unlockConnection).toHaveBeenCalledOnce();
  });

  it("retains local credentials when GitHub revocation fails so disconnect can be retried", async () => {
    vi.mocked(revokeToken).mockRejectedValue(new GitHubError(503));
    await expect(disconnectGitHub("user-a")).rejects.toThrow();
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(unlockConnection).toHaveBeenCalledOnce();
  });
});
