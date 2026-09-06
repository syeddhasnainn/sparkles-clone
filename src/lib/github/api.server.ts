import { z } from "zod";

export class GitHubError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 429 || status === 403
        ? "GitHub access is unavailable. Check repository permissions or try again later."
        : "Could not complete the GitHub request.",
    );
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
  refresh_token_expires_in: z.number().positive(),
});

export const profileSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.url().startsWith("https://"),
});

export const installationsSchema = z.object({
  total_count: z.number(),
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      account: profileSchema,
      suspended_at: z.string().nullable(),
    }),
  ),
});

export const repositoriesSchema = z.object({
  total_count: z.number(),
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      default_branch: z.string(),
      archived: z.boolean(),
    }),
  ),
});

export async function requestGitHub<T>(
  token: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Sparkles",
    },
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });

  if (!response.ok) {
    throw new GitHubError(response.status);
  }

  return schema.parse(await response.json());
}

export async function exchangeToken(
  clientId: string,
  clientSecret: string,
  parameters: Record<string, string>,
) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parameters }),
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });

  if (!response.ok) {
    throw new GitHubError(response.status);
  }

  const parsed = tokenSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new GitHubError(401);
  }

  return parsed.data;
}

export async function revokeToken(
  clientId: string,
  clientSecret: string,
  token: string,
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/applications/${encodeURIComponent(clientId)}/token`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/json",
        "User-Agent": "Sparkles",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    },
  );

  if (!response.ok && response.status !== 404) {
    throw new GitHubError(response.status);
  }
}
