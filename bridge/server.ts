import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { Readable } from "node:stream";
import { once } from "node:events";
import { bridgeRequestSchema, checkpointRequestSchema, restoreRequestSchema } from "./contracts.ts";
import type { SandboxProvider } from "./modal-provider.ts";

export function createBridgeServer(provider: SandboxProvider, token?: string) {
  const operations = new Map<string, Promise<void>>();
  const run = async <T>(name: string, callback: () => Promise<T>): Promise<T> => {
    const previous = operations.get(name) ?? Promise.resolve();
    const operation = previous.then(callback);
    const settled = operation.then(
      () => {},
      () => {},
    );
    operations.set(name, settled);
    try {
      return await operation;
    } finally {
      if (operations.get(name) === settled) operations.delete(name);
    }
  };
  return createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (
      request.method !== "POST" ||
      !["/workspace", "/checkpoint", "/restore"].includes(request.url || "")
    ) {
      response.writeHead(404).end('{"error":"Not found"}');
      return;
    }
    if (request.headers.origin || (token && request.headers.authorization !== `Bearer ${token}`)) {
      response.writeHead(403).end('{"error":"Forbidden"}');
      return;
    }
    try {
      if (request.url === "/restore") {
        if (!provider.restore) throw new Error("Restore unavailable");
        const header = request.headers["x-sparkles-restore"];
        const parsed = restoreRequestSchema.safeParse(
          JSON.parse(decodeURIComponent(String(header))),
        );
        if (!parsed.success) {
          response.writeHead(400).end('{"error":"Invalid restore request"}');
          return;
        }
        const restore = provider.restore.bind(provider);
        await run(parsed.data.name, () => restore(parsed.data, requestBody(request)));
        response.end('{"restored":true}');
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 100_000) {
          response.writeHead(413).end('{"error":"Request too large"}');
          return;
        }
      }
      if (request.url === "/checkpoint") {
        const parsed = checkpointRequestSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          response.writeHead(400).end('{"error":"Invalid checkpoint request"}');
          return;
        }
        if (!provider.checkpoint) throw new Error("Checkpoint unavailable");
        const checkpoint = provider.checkpoint.bind(provider);
        await run(parsed.data.name, async () => {
          const archive = await checkpoint(parsed.data);
          response.setHeader("Content-Type", "application/gzip");
          response.setHeader("Content-Length", String(archive.metadata.size));
          response.setHeader(
            "X-Sparkles-Checkpoint",
            encodeURIComponent(JSON.stringify(archive.metadata)),
          );
          const reader = archive.body.getReader();
          const abort = new AbortController();
          const onClose = () => {
            abort.abort();
            void reader.cancel().catch(() => {});
          };
          response.once("close", onClose);
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              if (!response.write(next.value))
                await once(response, "drain", { signal: abort.signal });
            }
            response.end();
          } finally {
            response.off("close", onClose);
            reader.releaseLock();
          }
        });
        return;
      }
      const parsed = bridgeRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) {
        response.writeHead(400).end('{"error":"Invalid request"}');
        return;
      }
      response.end(
        JSON.stringify(await run(parsed.data.name, () => provider.execute(parsed.data))),
      );
    } catch {
      if (response.headersSent) response.destroy();
      else response.writeHead(502).end('{"error":"Workspace provider unavailable"}');
    }
  });
}

function requestBody(request: IncomingMessage): ReadableStream<Uint8Array> {
  const reader = Readable.toWeb(request).getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(z.instanceof(Uint8Array).parse(next.value));
    },
    async cancel() {
      await reader.cancel();
    },
  });
}
