import { z } from "zod";
import { workspaceLifetimeMs, checkpointGraceMs } from "../../../bridge/contracts";

const endpoint = "/api/model/chat/completions";
const upstream = "https://openrouter.ai/api/v1/chat/completions";
const maximumBodyBytes = 8 * 1024 * 1024;
const grantSchema = z.object({ model: z.string() });
const errorResponse = (status: number, message: string) =>
  Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });

async function tokenHash(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueModelGateway(
  db: D1Database,
  taskId: string,
  runId: string,
  baseUrl: string,
  configuredModel: string,
) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Model gateway requires a public HTTPS URL.");
  const model = configuredModel || "openrouter/anthropic/claude-sonnet-4";
  if (!model.startsWith("openrouter/"))
    throw new Error("The gateway requires an OpenRouter model.");
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const result = await db
    .prepare(
      "INSERT INTO model_gateway_tokens(token_hash, task_id, user_id, run_id, model, expires_at) SELECT ?, task_id, user_id, run_id, ?, ? FROM agent_sessions WHERE task_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted', 'failed')",
    )
    .bind(
      await tokenHash(token),
      model.slice("openrouter/".length),
      Date.now() + workspaceLifetimeMs + checkpointGraceMs,
      taskId,
      runId,
    )
    .run();
  if (result.meta.changes !== 1) throw new Error("Cannot authorize an inactive model gateway run.");
  await db.prepare("DELETE FROM model_gateway_tokens WHERE expires_at < ?").bind(Date.now()).run();
  return { url: `${url.origin}/api/model`, token, model };
}

export async function revokeModelGateway(db: D1Database, runId: string) {
  await db
    .prepare("UPDATE model_gateway_tokens SET revoked = 1 WHERE run_id = ?")
    .bind(runId)
    .run();
}

export async function modelGateway(
  request: Request,
  environment: Pick<Env, "DB" | "OPENROUTER_API_KEY">,
  fetchUpstream: typeof fetch = fetch,
): Promise<Response> {
  if (new URL(request.url).pathname !== endpoint || request.method !== "POST")
    return errorResponse(404, "Not found");
  if (request.headers.has("origin")) return errorResponse(403, "Forbidden");
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1];
  if (!token) return errorResponse(401, "Invalid gateway credential");
  const grant = grantSchema.safeParse(
    await environment.DB.prepare(
      "SELECT t.model FROM model_gateway_tokens t JOIN agent_sessions s ON s.task_id = t.task_id AND s.user_id = t.user_id AND s.run_id = t.run_id WHERE t.token_hash = ? AND t.revoked = 0 AND t.expires_at > ? AND s.status NOT IN ('stopped', 'interrupted', 'failed')",
    )
      .bind(await tokenHash(token), Date.now())
      .first(),
  );
  if (!grant.success) return errorResponse(401, "Invalid gateway credential");
  if (!environment.OPENROUTER_API_KEY) return errorResponse(503, "Model provider unavailable");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return errorResponse(415, "Expected JSON");
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse(400, "Empty request");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBodyBytes) {
        await reader.cancel();
        return errorResponse(413, "Request too large");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = z.record(z.string(), z.unknown()).parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (
      body.model !== grant.data.model ||
      !Array.isArray(body.messages) ||
      body.models ||
      body.route ||
      body.provider
    )
      return errorResponse(400, "Invalid model request");
  } catch {
    return errorResponse(400, "Invalid JSON request");
  }
  try {
    const response = await fetchUpstream(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${environment.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]),
    });
    if (!response.ok) {
      console.error("Model gateway upstream failure", { status: response.status });
      await response.body?.cancel();
      return errorResponse(response.status === 429 ? 429 : 502, "Model provider request failed");
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": body.stream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Model gateway transport failure", {
      name: error instanceof Error ? error.name : "Unknown",
    });
    return errorResponse(502, "Model provider unavailable");
  }
}
