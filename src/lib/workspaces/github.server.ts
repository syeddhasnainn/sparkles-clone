import { createPrivateKey } from "node:crypto";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { resolveRepository } from "./repository-access";
import { githubRequest } from "../github/service.server";
import type { Repository } from "../../../bridge/contracts";

export function authorizeRepository(userId: string, selected: Repository) {
  return resolveRepository(userId, selected, githubRequest);
}

async function createInstallationToken(repository: Repository, write: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  const payload = `${encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  const key = createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"));
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    key.export({ format: "der", type: "pkcs8" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(payload),
  );
  const jwt = `${payload}.${Buffer.from(signature).toString("base64url")}`;
  const response = await fetch(
    `https://api.github.com/app/installations/${repository.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Sparkles",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({
        repository_ids: [repository.id],
        permissions: write ? { contents: "write", pull_requests: "write" } : { contents: "read" },
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    },
  );

  if (!response.ok) throw new Error("Could not authorize repository checkout.");
  return z
    .object({ token: z.string().min(1), expires_at: z.iso.datetime() })
    .parse(await response.json());
}

export async function revokeCheckoutToken(token: string) {
  const response = await fetch("https://api.github.com/installation/token", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Sparkles",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  });
  if (!response.ok && response.status !== 401)
    throw new Error("Checkout credential cleanup failed.");
}

export async function createCheckoutToken(repository: Repository): Promise<string> {
  return (await createInstallationToken(repository, false)).token;
}

export async function createWorkspaceGitHubCredentials(userId: string, selected: Repository) {
  const repository = await authorizeRepository(userId, selected);
  const access = await githubRequest(
    userId,
    `/repos/${repository.name}`,
    z.object({
      id: z.number(),
      permissions: z.object({ push: z.boolean() }),
    }),
  );
  if (access.id !== repository.id) throw new Error("Repository access changed.");
  const profile = await githubRequest(
    userId,
    "/user",
    z.object({ id: z.number(), login: z.string() }),
  );
  const issued = await createInstallationToken(repository, access.permissions.push);
  return {
    token: issued.token,
    expiresAt: Date.parse(issued.expires_at),
    repository: repository.name,
    login: profile.login,
    name: profile.login,
    email: `${profile.id}+${profile.login}@users.noreply.github.com`,
  };
}
