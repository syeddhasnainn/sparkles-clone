import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { build } from "vite";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { z } from "zod";
import {
  browserProbeProfileSchema,
  browserProbeSeedSchema,
} from "./__tests__/browser-profile-worker";
import type {
  BrowserProbeLease,
  BrowserProbeOwner,
  BrowserProbeRequest,
} from "./__tests__/browser-profile-worker";

let runtime: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  const entry = new URL("./__tests__/browser-profile-worker.ts", import.meta.url).pathname;
  const output = await build({
    configFile: false,
    logLevel: "silent",
    ssr: { noExternal: true },
    build: { ssr: entry, write: false, minify: false, target: "esnext" },
  });
  const bundle = z
    .object({
      output: z.array(
        z.object({
          type: z.string(),
          isEntry: z.boolean().optional(),
          code: z.string().optional(),
        }),
      ),
    })
    .parse(output);
  const script = z.string().parse(bundle.output.find((item) => item.isEntry)?.code);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-06",
      r2Buckets: ["PROFILES"],
      d1Databases: ["DB"],
    }),
  );
  bucket = (await runtime.getBindings<{ PROFILES: R2Bucket }>()).PROFILES;
  const database = await runtime.getD1Database("DB");
  const migration = await readFile(
    new URL("../../../migrations/0006_browser_profiles.sql", import.meta.url),
    "utf8",
  );
  await database.exec(migration.replaceAll("\n", " "));
}, 30000);

afterAll(async () => {
  await runtime?.dispose();
});

const owner = (): BrowserProbeOwner => ({ userId: crypto.randomUUID(), repositoryId: 731 });

function request(input: BrowserProbeRequest) {
  return runtime.dispatchFetch("http://browser-profile.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function seed(profileOwner: BrowserProbeOwner) {
  const response = await request({ action: "seed", owner: profileOwner });
  expect(response.status).toBe(200);
  return browserProbeSeedSchema.parse(await response.json());
}

async function publish(
  profileOwner: BrowserProbeOwner,
  lease: BrowserProbeLease,
  value = "synthetic-login",
) {
  const response = await request({ action: "publish", owner: profileOwner, lease, value });
  expect(response.status, await response.clone().text()).toBe(200);
  return browserProbeProfileSchema.parse(await response.json());
}

async function objects(profileOwner: BrowserProbeOwner) {
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(profileOwner.userId)),
  ).toString("hex");
  return (await bucket.list({ prefix: `browser-profiles/${hash}/` })).objects;
}

describe("saved cloud-browser profiles in a real Worker", () => {
  it("encrypts multiple chunks in R2 and restores only the correct user and project", async () => {
    const user = owner();
    const initial = await seed(user);
    const value = "synthetic-private-session-".repeat(45000);
    const profile = await publish(user, initial.lease, value);
    const result = await request({ action: "read", owner: user, profile });
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(value);
    const encrypted = await bucket.get(profile.key);
    expect(encrypted).not.toBeNull();
    const ciphertext = await encrypted!.arrayBuffer();
    expect(Buffer.from(ciphertext).includes(Buffer.from("synthetic-private-session-"))).toBe(false);
    expect(ciphertext.byteLength).toBe(profile.encryptedSize);

    const otherUser = await request({ action: "read", owner: owner(), profile });
    const otherProject = await request({
      action: "read",
      owner: { ...user, repositoryId: 732 },
      profile,
    });
    expect(otherUser.status).toBe(400);
    expect(otherProject.status).toBe(400);
    expect((await seed({ ...user, repositoryId: 732 })).profile).toBeNull();
  });

  it("detects encrypted archive tampering", async () => {
    const user = owner();
    const profile = await publish(user, (await seed(user)).lease);
    const original = await bucket.get(profile.key);
    expect(original).not.toBeNull();
    const ciphertext = new Uint8Array(await original!.arrayBuffer());
    ciphertext[ciphertext.length - 1] ^= 1;
    await bucket.put(profile.key, ciphertext, { customMetadata: original!.customMetadata });
    const response = await request({ action: "read", owner: user, profile });
    expect(response.status).toBe(400);
  });

  it("rejects stale writers while keeping the last successful saved session", async () => {
    const user = owner();
    const initial = await seed(user);
    const saved = await publish(user, initial.lease);
    const stale = await request({
      action: "publish",
      owner: user,
      lease: initial.lease,
      value: "stale-browser-state",
    });
    expect(stale.status).toBe(400);
    expect((await seed(user)).profile?.key).toBe(saved.key);
    expect(await objects(user)).toHaveLength(1);
  });

  it("retains the previous profile when an upload ends prematurely", async () => {
    const user = owner();
    const saved = await publish(user, (await seed(user)).lease);
    const failed = await request({
      action: "publish_incomplete",
      owner: user,
      lease: { generation: saved.generation, revision: saved.revision },
      value: "incomplete-upload",
    });
    expect(failed.status).toBe(400);
    expect((await seed(user)).profile?.key).toBe(saved.key);
    const response = await request({ action: "read", owner: user, profile: saved });
    expect(await response.text()).toBe("synthetic-login");
  });

  it("clears only the selected user's profiles and fences old saves and restores", async () => {
    const user = owner();
    const other = owner();
    const saved = await publish(user, (await seed(user)).lease);
    const otherSaved = await publish(other, (await seed(other)).lease);
    const cleared = await request({ action: "clear", owner: user });
    expect(cleared.status).toBe(200);
    const current = await seed(user);
    expect(current.profile).toBeNull();
    expect(current.lease.generation).toBe(saved.generation + 1);
    expect((await seed(other)).profile?.key).toBe(otherSaved.key);
    const stale = await request({
      action: "publish",
      owner: user,
      lease: { generation: saved.generation, revision: saved.revision },
      value: "cleared-login",
    });
    const restored = await request({ action: "read", owner: user, profile: saved });
    expect(stale.status).toBe(400);
    expect(restored.status).toBe(400);
    expect(await objects(user)).toEqual([]);
  });

  it("cannot publish or orphan an in-flight upload after sessions are cleared", async () => {
    const user = owner();
    const initial = await seed(user);
    const token = crypto.randomUUID();
    const upload = request({
      action: "publish_slow",
      owner: user,
      lease: initial.lease,
      value: "old-in-flight-login",
      token,
    });
    try {
      await expect
        .poll(async () => {
          const response = await request({ action: "upload_pending", owner: user, token });
          return z.object({ pending: z.boolean() }).parse(await response.json()).pending;
        })
        .toBe(true);
      const cleared = await request({ action: "clear", owner: user });
      expect(cleared.status).toBe(200);
    } finally {
      await request({ action: "release", token });
    }
    expect((await upload).status).toBe(400);
    expect((await seed(user)).profile).toBeNull();
    await request({ action: "cleanup", owner: user });
    expect(await objects(user)).toEqual([]);
  });

  it("does not clean up a staged upload before it can become canonical", async () => {
    const user = owner();
    const initial = await seed(user);
    const token = crypto.randomUUID();
    const upload = request({
      action: "publish_slow",
      owner: user,
      lease: initial.lease,
      value: "in-flight-login",
      token,
    });
    try {
      await expect
        .poll(async () => {
          const response = await request({ action: "upload_pending", owner: user, token });
          return z.object({ pending: z.boolean() }).parse(await response.json()).pending;
        })
        .toBe(true);

      const cleanup = await request({ action: "cleanup", owner: user });
      expect(z.object({ pending: z.literal(true) }).parse(await cleanup.json()).pending).toBe(true);
    } finally {
      await request({ action: "release", token });
    }
    const profile = browserProbeProfileSchema.parse(await (await upload).json());
    expect(await (await request({ action: "read", owner: user, profile })).text()).toBe(
      "in-flight-login",
    );
    expect(await objects(user)).toHaveLength(1);
  });
});
