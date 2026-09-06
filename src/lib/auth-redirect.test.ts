import { describe, expect, it } from "vitest";
import { authReturnPath } from "./auth-redirect";

describe("authentication return paths", () => {
  it.each([
    undefined,
    null,
    "https://example.com/app",
    "//example.com/app",
    "/application",
    "/app/../../outside",
    "/app\\example.com",
    "/app\r\nLocation: https://example.com",
    "/api/auth/sign-in",
  ])("rejects an unsafe or unrelated destination: %s", (value) => {
    expect(authReturnPath(value)).toBe("/app");
  });

  it("preserves an internal destination and query", () => {
    expect(authReturnPath("/app/settings/account?tab=profile")).toBe(
      "/app/settings/account?tab=profile",
    );
  });
});
