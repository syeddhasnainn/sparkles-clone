import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeToken, GitHubError, profileSchema, requestGitHub } from "./api.server";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub API boundary", () => {
  it("keeps GitHub error payloads out of application errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: "provider-private-data" }), { status: 401 }),
        ),
    );
    await expect(requestGitHub("secret", "/user", profileSchema)).rejects.toThrow(GitHubError);
    await expect(requestGitHub("secret", "/user", profileSchema)).rejects.not.toThrow(
      "provider-private-data",
    );
  });

  it("requires expiring GitHub App tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "token" }))),
    );
    await expect(
      exchangeToken("client", "secret", { code: "code", code_verifier: "verifier" }),
    ).rejects.toThrow(GitHubError);
  });

  it("handles OAuth errors returned with a successful HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad_verification_code" }))),
    );
    await expect(exchangeToken("client", "secret", { code: "code" })).rejects.toThrow(GitHubError);
  });

  it("sends token exchanges only to GitHub and refuses redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await exchangeToken("client", "secret", { code: "code", code_verifier: "verifier" });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(options.redirect).toBe("error");
    expect(options.body.get("code_verifier")).toBe("verifier");
  });
});
