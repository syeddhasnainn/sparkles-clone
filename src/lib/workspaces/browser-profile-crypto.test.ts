import { describe, expect, it } from "vitest";
import {
  decryptBrowserProfile,
  encryptBrowserProfile,
  encryptedBrowserProfileSize,
} from "./browser-profile-crypto";

const secret = "a7".repeat(32);
const context = {
  userId: "user-a",
  repositoryId: 42,
  generation: 3,
  revision: 8,
  id: "7a7fa83a-08fc-44fe-a81a-7837462a2410",
  size: 512 * 1024 + 37,
  sha256: "1".repeat(64),
};

async function bytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("browser profile encryption", () => {
  it("round trips chunked archives without exposing plaintext", async () => {
    const plaintext = Uint8Array.from({ length: context.size }, (_, index) => index % 251);
    const encrypted = await bytes(
      encryptBrowserProfile(new Blob([plaintext]).stream(), secret, context),
    );

    expect(encrypted.byteLength).toBe(encryptedBrowserProfileSize(plaintext.byteLength));
    expect(Buffer.from(encrypted).includes(Buffer.from(plaintext.slice(0, 32)))).toBe(false);
    expect(
      await bytes(decryptBrowserProfile(new Blob([encrypted]).stream(), secret, context)),
    ).toEqual(plaintext);
  });

  it("authenticates ownership, version and every encrypted frame", async () => {
    const plaintext = new Uint8Array(context.size).fill(17);
    const encrypted = await bytes(
      encryptBrowserProfile(new Blob([plaintext]).stream(), secret, context),
    );
    const tampered = encrypted.slice();
    tampered[tampered.length - 1] ^= 1;

    await expect(
      bytes(decryptBrowserProfile(new Blob([tampered]).stream(), secret, context)),
    ).rejects.toThrow();
    await expect(
      bytes(
        decryptBrowserProfile(new Blob([encrypted]).stream(), secret, {
          ...context,
          userId: "user-b",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects incomplete plaintext and encrypted streams", async () => {
    await expect(
      bytes(
        encryptBrowserProfile(
          new Blob([new Uint8Array(context.size - 1)]).stream(),
          secret,
          context,
        ),
      ),
    ).rejects.toThrow("incomplete");

    const encrypted = await bytes(
      encryptBrowserProfile(new Blob([new Uint8Array(context.size)]).stream(), secret, context),
    );
    await expect(
      bytes(decryptBrowserProfile(new Blob([encrypted.slice(0, -1)]).stream(), secret, context)),
    ).rejects.toThrow("incomplete");
  });
});
