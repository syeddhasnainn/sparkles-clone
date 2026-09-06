import { z } from "zod";

export function authReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/app") || /[\\\r\n]/.test(value)) {
    return "/app";
  }

  try {
    const url = new URL(value, "https://app.local");

    if (url.origin !== "https://app.local" || !/^\/app(?:\/|$)/.test(url.pathname)) {
      return "/app";
    }

    return url.pathname + url.search;
  } catch {
    return "/app";
  }
}

export const signInSearchSchema = z.object({
  returnTo: z.string().catch("/app").transform(authReturnPath),
  error: z.literal("auth_failed").optional().catch(undefined),
});

export function safeAuthRedirect(value: string | null | undefined) {
  return { href: authReturnPath(value) };
}
