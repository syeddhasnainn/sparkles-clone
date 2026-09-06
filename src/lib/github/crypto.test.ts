import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomSecret, sha256 } from "./crypto";

const key = "ad".repeat(32);

describe("GitHub credential encryption", () => {
  it("round-trips credentials with a fresh nonce for each encryption", async () => {
    const first = await encrypt("private-token", key, "github:connection:user-a");
    const second = await encrypt("private-token", key, "github:connection:user-a");
    expect(first).not.toEqual(second);
    expect(first).not.toContain("private-token");
    expect(await decrypt(first, key, "github:connection:user-a")).toBe("private-token");
  });

  it("rejects credentials copied to another user", async () => {
    const value = await encrypt("private-token", key, "github:connection:user-a");
    await expect(decrypt(value, key, "github:connection:user-b")).rejects.toThrow();
  });

  it("rejects tampered credentials and incorrect keys", async () => {
    const value = await encrypt("private-token", key, "github:connection:user-a");
    const [iv, ciphertext] = value.split(".");
    const changed = `${iv}.${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    await expect(decrypt(changed, key, "github:connection:user-a")).rejects.toThrow();
    await expect(decrypt(value, "ef".repeat(32), "github:connection:user-a")).rejects.toThrow();
  });

  it("rejects invalid encryption keys", async () => {
    await expect(encrypt("token", "short-key", "user")).rejects.toThrow();
  });

  it("generates URL-safe state and RFC 7636 S256 challenges", async () => {
    expect(randomSecret()).toMatch(/^[\w-]{43}$/);
    expect(await sha256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
