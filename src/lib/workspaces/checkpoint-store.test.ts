import { afterAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createCheckpointStore } from "./checkpoint-store";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test'); } }",
    compatibilityDate: "2026-09-06",
    r2Buckets: ["CHECKPOINTS"],
  }),
);
const { CHECKPOINTS: bucket } = await runtime.getBindings<{ CHECKPOINTS: R2Bucket }>();
const store = createCheckpointStore(bucket);
const owner = { taskId: "task-a", userId: "user-a", runId: "run-a" };
afterAll(() => runtime.dispose());

describe("checkpoint object ownership", () => {
  it("validates the object owner as well as the task key before restoring", async () => {
    const bytes = new TextEncoder().encode("saved checkpoint");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const metadata = {
      id: crypto.randomUUID(),
      sessionId: "session",
      cursor: 1,
      createdAt: Date.now(),
      size: bytes.length,
      sha256: Buffer.from(digest).toString("hex"),
      interrupted: false,
    };
    const checkpoint = { key: `tasks/${owner.taskId}/${metadata.id}.tar.gz`, metadata };
    await bucket.put(checkpoint.key, bytes, {
      sha256: metadata.sha256,
      customMetadata: { taskId: owner.taskId, userId: owner.userId },
    });
    expect(await new Response(await store.get(owner, checkpoint)).text()).toBe("saved checkpoint");
    await expect(store.get({ ...owner, userId: "user-b" }, checkpoint)).rejects.toThrow(
      "missing or incomplete",
    );
    await expect(store.get({ ...owner, taskId: "task-b" }, checkpoint)).rejects.toThrow(
      "does not belong",
    );
  });
  it("does not expose an uploaded object when the integrity check fails", async () => {
    const metadata = {
      id: crypto.randomUUID(),
      sessionId: "session",
      cursor: 1,
      createdAt: Date.now(),
      size: 7,
      sha256: "0".repeat(64),
      interrupted: false,
    };
    await expect(
      bucket.put(`tasks/${owner.taskId}/${metadata.id}.tar.gz`, "corrupt", {
        sha256: metadata.sha256,
      }),
    ).rejects.toThrow();
    expect(await bucket.get(`tasks/${owner.taskId}/${metadata.id}.tar.gz`)).toBeNull();
  });
});
