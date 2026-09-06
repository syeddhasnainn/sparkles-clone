export function authReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/app") || /[\\\r\n]/.test(value)) {
    return "/app";
  }
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local" || !/^\/app(?:\/|$)/.test(url.pathname)) return "/app";
    return url.pathname + url.search;
  } catch {
    return "/app";
  }
}
