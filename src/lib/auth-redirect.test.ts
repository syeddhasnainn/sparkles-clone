import { describe, expect, it } from "vitest";
import { authReturnPath, signInSearchSchema } from "./auth-redirect";

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

describe("sign-in search validation", () => {
  it.each([42, false, ["/app/settings/account"], { returnTo: "/app" }, null])(
    "defaults malformed return paths at the URL boundary: %j",
    (returnTo) => {
      expect(signInSearchSchema.parse({ returnTo, error: "unexpected" })).toEqual({
        returnTo: "/app",
        error: undefined,
      });
    },
  );

  it("preserves valid return paths and the known authentication error", () => {
    expect(
      signInSearchSchema.parse({
        returnTo: "/app/settings/account?tab=profile",
        error: "auth_failed",
      }),
    ).toEqual({
      returnTo: "/app/settings/account?tab=profile",
      error: "auth_failed",
    });
  });
});
