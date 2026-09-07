import { issueModelGateway, revokeModelGateway } from "./model-gateway";
import { requireChatGPTModel } from "../chatgpt/models";
import { z } from "zod";
import { createChatGPTService } from "../chatgpt/service";
import { bridgeResponseSchema, checkpointMetadataSchema } from "../../../bridge/contracts";
import type {
  BridgeRequest,
  BridgeResponse,
  CheckpointArchive,
  CheckpointRequest,
  RestoreRequest,
} from "../../../bridge/contracts";

export interface WorkspaceProvider {
  execute(request: BridgeRequest): Promise<BridgeResponse>;
  checkpoint?(request: CheckpointRequest): Promise<CheckpointArchive>;
  restore?(request: RestoreRequest, body: ReadableStream<Uint8Array>): Promise<void>;
}

export function containerProvider(
  environment: Env & { LOCAL_MODAL_BRIDGE_URL?: string; LOCAL_MODAL_BRIDGE_TOKEN?: string },
  shard: string,
  taskId: string,
): WorkspaceProvider {
  const call = async (path: string, body: BodyInit, headers = new Headers()) => {
    const localUrl = import.meta.env.DEV ? environment.LOCAL_MODAL_BRIDGE_URL : undefined;
    if (localUrl) {
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(localUrl) || !environment.LOCAL_MODAL_BRIDGE_TOKEN)
        throw new Error("Invalid local bridge configuration.");
      headers.set("Authorization", `Bearer ${environment.LOCAL_MODAL_BRIDGE_TOKEN}`);
    }
    const options = { method: "POST", headers, body, signal: AbortSignal.timeout(240_000) };
    const response = localUrl
      ? await fetch(`${localUrl}${path}`, options)
      : await environment.MODAL_BRIDGE.getByName(shard).fetch(`http://bridge${path}`, options);
    if (!response.ok) throw new Error("Workspace provider unavailable.");
    return response;
  };
  return {
    async execute(request) {
      const runId = request.name.slice("sparkles-".length);
      if (request.action === "stop") await revokeModelGateway(environment.DB, runId);
      if (request.action === "create" || request.action === "start") {
        request = {
          ...request,
          gateway: await issueModelGateway(
            environment.DB,
            taskId,
            runId,
            environment.MODEL_GATEWAY_URL,
            environment.AGENT_MODEL,
            (userId) => createChatGPTService(environment).requireConnection(userId),
          ),
        };
      }
      if (
        (request.action === "create" || request.action === "start") &&
        request.gateway?.provider === "chatgpt"
      ) {
        const owner = z
          .object({ user_id: z.string() })
          .parse(
            await environment.DB.prepare(
              "SELECT user_id FROM agent_sessions WHERE task_id = ? AND run_id = ?",
            )
              .bind(taskId, runId)
              .first(),
          );
        const model = await requireChatGPTModel(
          environment,
          owner.user_id,
          request.gateway.model.replace(/^openai\//, ""),
        );
        if (
          request.gateway.reasoningEffort &&
          !model.reasoningEfforts.includes(request.gateway.reasoningEffort)
        )
          throw new Error("This model does not support the selected reasoning effort.");
        request = {
          ...request,
          gateway: { ...request.gateway, contextWindow: model.contextWindow },
        };
      }
      return bridgeResponseSchema.parse(
        await (
          await call(
            "/workspace",
            JSON.stringify(request),
            new Headers({ "Content-Type": "application/json" }),
          )
        ).json(),
      );
    },
    async checkpoint(request) {
      const response = await call(
        "/checkpoint",
        JSON.stringify(request),
        new Headers({ "Content-Type": "application/json" }),
      );
      const metadata = checkpointMetadataSchema.parse(
        JSON.parse(decodeURIComponent(response.headers.get("X-Sparkles-Checkpoint") || "")),
      );
      if (!response.body) throw new Error("Checkpoint transfer is empty.");
      return { metadata, body: response.body };
    },
    async restore(request, body) {
      await call(
        "/restore",
        body,
        new Headers({
          "Content-Type": "application/gzip",
          "Content-Length": String(request.checkpoint.size),
          "X-Sparkles-Restore": encodeURIComponent(JSON.stringify(request)),
        }),
      );
    },
  };
}
