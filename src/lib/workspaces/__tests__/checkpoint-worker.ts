import { createCheckpointStore } from "../checkpoint-store";

export default {
  async fetch(request: Request, env: { CHECKPOINTS: R2Bucket }) {
    const value = new TextEncoder().encode("saved checkpoint");
    const digest = await crypto.subtle.digest("SHA-256", value);
    const mode = new URL(request.url).pathname;
    const metadata = {
      id: mode.slice(1),
      sessionId: "session",
      cursor: 1,
      createdAt: Date.now(),
      size: value.length + (mode === "/truncated" ? 1 : 0),
      sha256:
        mode === "/corrupt"
          ? "0".repeat(64)
          : Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
              "",
            ),
      interrupted: false,
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(value);
        controller.close();
      },
    });
    const store = createCheckpointStore(env.CHECKPOINTS);
    const owner = { taskId: "upload-task", userId: "user", runId: "run" };

    try {
      const saved = await store.put(owner, { metadata, body });
      return new Response(await store.get(owner, saved));
    } catch (error) {
      return new Response(error instanceof Error ? error.message : "Upload failed", {
        status: 500,
      });
    }
  },
};
