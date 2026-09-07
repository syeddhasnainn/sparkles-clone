import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { z } from "zod";

// Only this endpoint is exposed by the development tunnel, never the app or bridge APIs.
export async function startLocalModelGateway() {
  const server = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      !["/api/model/chat/completions", "/api/model/responses"].includes(request.url || "") ||
      request.headers.origin
    ) {
      response.writeHead(404).end();
      return;
    }
    const forwarded = httpRequest(
      `http://localhost:3000${request.url}`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers["content-type"] || "application/octet-stream",
          Authorization: request.headers.authorization || "",
        },
      },
      (upstream) => {
        response.writeHead(upstream.statusCode || 502, {
          // Quick Tunnels buffer text/event-stream. The AI SDK parses SSE bytes
          // from fetch directly, so transport them as a streamed byte response locally.
          "Content-Type": upstream.headers["content-type"]?.startsWith("text/event-stream")
            ? "application/octet-stream"
            : upstream.headers["content-type"] || "application/json",
          "Cache-Control": "no-store",
        });
        upstream.on("error", () => response.destroy());
        response.once("close", () => upstream.destroy());
        upstream.pipe(response);
      },
    );
    forwarded.on("error", () => {
      if (response.headersSent) response.destroy();
      else response.writeHead(502).end();
    });
    request.once("aborted", () => forwarded.destroy());
    response.once("close", () => forwarded.destroy());
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = z.object({ port: z.number() }).parse(server.address());
  const tunnel = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const close = () => {
    tunnel.kill();
    server.closeAllConnections();
    server.close();
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Local model gateway tunnel timed out.")),
        45000,
      );
      let log = "";
      tunnel.stderr.on("data", (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-16000);
        const address = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (address) {
          clearTimeout(timer);
          resolve(address[0]);
        }
      });
      tunnel.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Install cloudflared to run the local model gateway."));
      });
      tunnel.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Local model gateway tunnel stopped."));
      });
    });
    return { url, close };
  } catch (error) {
    close();
    throw error;
  }
}
