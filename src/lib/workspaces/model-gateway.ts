import { z } from "zod";
import { agentSelectionSchema, defaultAgentSelection } from "../../../bridge/agent-selection";
import { createChatGPTService } from "../chatgpt/service";
import { ChatGPTError } from "../chatgpt/api";
import { relayChatGPT, type ChatGPTRelayEnvironment } from "../chatgpt/relay";
import { workspaceLifetimeMs, checkpointGraceMs } from "../../../bridge/contracts";

const endpoint = "/api/model/chat/completions";
const upstream = "https://openrouter.ai/api/v1/chat/completions";
const maximumBodyBytes = 8 * 1024 * 1024;
const grantSchema = z.object({
  task_id: z.string(),
  model: z.string(),
  user_id: z.string(),
  provider: z.enum(["openrouter", "chatgpt"]),
  connection_id: z.string().nullable(),
});
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
  requireConnection?: (userId: string) => Promise<string>,
) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Model gateway requires a public HTTPS URL.");
  const sessionResult = z
    .object({
      user_id: z.string(),
      selection: z.string().nullable(),
      connection_id: z.string().nullable(),
    })
    .safeParse(
      await db
        .prepare(
          "SELECT user_id, selection, connection_id FROM agent_sessions WHERE task_id = ? AND run_id = ?",
        )
        .bind(taskId, runId)
        .first(),
    );
  if (!sessionResult.success) throw new Error("Cannot authorize an inactive model gateway run.");
  const session = sessionResult.data;
  const selection = session.selection
    ? agentSelectionSchema.parse(JSON.parse(session.selection))
    : defaultAgentSelection;
  const model =
    selection.provider === "chatgpt"
      ? `openai/${selection.model}`
      : configuredModel || "openrouter/z-ai/glm-5.3-flash";
  let connectionId: string | null = null;
  if (selection.provider === "chatgpt") {
    if (!requireConnection) throw new Error("ChatGPT connections are unavailable.");
    connectionId = await requireConnection(session.user_id);
    if (session.connection_id && session.connection_id !== connectionId)
      throw new Error("This task belongs to a disconnected ChatGPT connection. Start a new task.");
    await db
      .prepare(
        "UPDATE agent_sessions SET connection_id = ? WHERE task_id = ? AND run_id = ? AND connection_id IS NULL",
      )
      .bind(connectionId, taskId, runId)
      .run();
  } else if (!model.startsWith("openrouter/"))
    throw new Error("The gateway requires an OpenRouter model.");
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const result = await db
    .prepare(
      "INSERT INTO model_gateway_tokens(token_hash, task_id, user_id, run_id, model, expires_at, provider, connection_id) SELECT ?, task_id, user_id, run_id, ?, ?, ?, ? FROM agent_sessions WHERE task_id = ? AND run_id = ? AND status NOT IN ('stopped', 'interrupted', 'failed')",
    )
    .bind(
      await tokenHash(token),
      model.slice(model.indexOf("/") + 1),
      Date.now() + workspaceLifetimeMs + checkpointGraceMs,
      selection.provider,
      connectionId,
      taskId,
      runId,
    )
    .run();
  if (result.meta.changes !== 1) throw new Error("Cannot authorize an inactive model gateway run.");
  await db.prepare("DELETE FROM model_gateway_tokens WHERE expires_at < ?").bind(Date.now()).run();
  return {
    url: `${url.origin}/api/model`,
    token,
    model,
    agent: selection.agent,
    provider: selection.provider,
    permissionMode:
      selection.provider === "chatgpt" && selection.agent === "codex"
        ? selection.permissionMode
        : undefined,
    reasoningEffort:
      selection.provider === "chatgpt" ? (selection.reasoningEffort ?? "medium") : undefined,
  };
}

export async function revokeModelGateway(db: D1Database, runId: string) {
  await db
    .prepare("UPDATE model_gateway_tokens SET revoked = 1 WHERE run_id = ?")
    .bind(runId)
    .run();
}

export async function modelGateway(
  request: Request,
  environment: Pick<Env, "DB" | "OPENROUTER_API_KEY"> &
    Partial<Pick<Env, "CHATGPT_TOKEN_ENCRYPTION_KEY">> &
    ChatGPTRelayEnvironment,
  fetchUpstream?: typeof fetch,
): Promise<Response> {
  const responses = new URL(request.url).pathname === "/api/model/responses";
  if ((!responses && new URL(request.url).pathname !== endpoint) || request.method !== "POST")
    return errorResponse(404, "Not found");
  if (request.headers.has("origin")) return errorResponse(403, "Forbidden");
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1];
  if (!token) return errorResponse(401, "Invalid gateway credential");
  const grant = grantSchema.safeParse(
    await environment.DB.prepare(
      "SELECT t.task_id, t.model, t.user_id, t.provider, t.connection_id FROM model_gateway_tokens t JOIN agent_sessions s ON s.task_id = t.task_id AND s.user_id = t.user_id AND s.run_id = t.run_id WHERE t.token_hash = ? AND t.revoked = 0 AND t.expires_at > ? AND s.status NOT IN ('stopped', 'interrupted', 'failed')",
    )
      .bind(await tokenHash(token), Date.now())
      .first(),
  );
  if (!grant.success) return errorResponse(401, "Invalid gateway credential");
  const subscription = grant.data.provider === "chatgpt";
  if (subscription !== responses)
    return errorResponse(400, "Model protocol does not match this task.");
  if (!subscription && !environment.OPENROUTER_API_KEY)
    return errorResponse(503, "Model provider unavailable");
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
      !(responses ? Array.isArray(body.input) : Array.isArray(body.messages)) ||
      body.models ||
      body.route ||
      body.provider
    )
      return errorResponse(400, "Invalid model request");
  } catch {
    return errorResponse(400, "Invalid JSON request");
  }
  try {
    const service = createChatGPTService({
      DB: environment.DB,
      CHATGPT_TOKEN_ENCRYPTION_KEY: environment.CHATGPT_TOKEN_ENCRYPTION_KEY || "",
    });
    const auth =
      subscription && grant.data.connection_id
        ? await service.access(grant.data.user_id, grant.data.connection_id)
        : null;
    if (subscription && !auth) return errorResponse(401, "Reconnect ChatGPT to continue.");
    if (subscription) {
      body.store = false;
      body.stream = true;
      body.instructions =
        z.string().safeParse(body.instructions).data ?? "You are a coding assistant.";
      delete body.max_output_tokens;
      delete body.temperature;
      delete body.top_p;
      delete body.previous_response_id;
    }
    const headers = new Headers({
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth?.token ?? environment.OPENROUTER_API_KEY}`,
    });
    if (auth) headers.set("ChatGPT-Account-Id", auth.accountId);
    const target = subscription ? "https://chatgpt.com/backend-api/codex/responses" : upstream;
    const send = () => {
      const options: RequestInit = {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]),
      };
      if (fetchUpstream) return fetchUpstream(target, options);
      return subscription ? relayChatGPT(environment, options) : fetch(target, options);
    };
    let response = await send();
    if (response.status === 401 && auth && grant.data.connection_id) {
      await response.body?.cancel();
      const refreshed = await service.access(grant.data.user_id, grant.data.connection_id, true);
      headers.set("Authorization", `Bearer ${refreshed.token}`);
      response = await send();
    }
    if (!response.ok) {
      console.error("Model gateway upstream failure", {
        status: response.status,
        taskId: grant.data.task_id,
        contentType: response.headers.get("content-type"),
        server: response.headers.get("server"),
        mitigation: response.headers.get("cf-mitigated"),
        requestId: response.headers.get("x-request-id"),
        ray: response.headers.get("cf-ray"),
      });
      await response.body?.cancel();
      return errorResponse(
        (subscription && response.status >= 400 && response.status < 500) || response.status === 429
          ? response.status
          : 502,
        subscription
          ? response.status === 403
            ? "OpenAI rejected the connection (403). The workspace is running, but ChatGPT could not accept the model request."
            : response.status === 401
              ? "Reconnect ChatGPT to continue."
              : response.status === 429
                ? "ChatGPT is rate limiting requests. Try again later or check your usage allowance."
                : "ChatGPT could not complete this request. Check your connection and selected model."
          : "Model provider request failed",
      );
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": body.stream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof ChatGPTError) return errorResponse(error.status, error.message);
    console.error("Model gateway transport failure", {
      name: error instanceof Error ? error.name : "Unknown",
    });
    return errorResponse(502, "Model provider unavailable");
  }
}
