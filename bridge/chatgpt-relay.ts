import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { z } from "zod";

const credentialsSchema = z.object({
  "x-sparkles-chatgpt-authorization": z.string().regex(/^Bearer .+$/),
  "chatgpt-account-id": z.string().min(1),
});

export async function relayChatGPTResponse(
  request: IncomingMessage,
  response: ServerResponse,
  fetchUpstream: typeof fetch = fetch,
) {
  const credentials = credentialsSchema.safeParse(request.headers);
  if (!credentials.success) {
    response.writeHead(400).end('{"error":"Missing ChatGPT credentials"}');
    return;
  }
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    response.writeHead(415).end('{"error":"Expected JSON"}');
    return;
  }

  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const onClose = () => {
    abort.abort();
    void reader?.cancel().catch(() => {});
  };
  response.once("close", onClose);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 8 * 1024 * 1024) {
        response.writeHead(413).end('{"error":"Request too large"}');
        return;
      }
      chunks.push(bytes);
    }

    const upstream = await fetchUpstream("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: credentials.data["x-sparkles-chatgpt-authorization"],
        "ChatGPT-Account-Id": credentials.data["chatgpt-account-id"],
      },
      body: Buffer.concat(chunks),
      redirect: "manual",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(300_000)]),
    });
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    reader = upstream.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!response.write(next.value)) await once(response, "drain", { signal: abort.signal });
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    response.end();
  } finally {
    response.off("close", onClose);
  }
}
