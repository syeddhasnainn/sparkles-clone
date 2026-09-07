import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireChatGPTModel } from "../chatgpt/models";
import { agentCommandSchema, createWorkspaceSchema } from "../../../bridge/contracts";
import { requireGitHubUser } from "../github/service.server";
import { authorizeRepository } from "./github.server";
import { workspaceViewCommandSchema } from "../../../bridge/workspace-view-contracts";

function configured() {
  return Boolean(
    env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY,
  );
}

const cloudBrowserSessionsSchema = z.object({
  count: z.number().int().nonnegative(),
  updatedAt: z.number().int().positive().nullable(),
  cleanupPending: z.boolean(),
  projects: z.array(
    z.object({
      repositoryId: z.number().int().positive(),
      repositoryName: z.string(),
      updatedAt: z.number().int().positive(),
    }),
  ),
});

const clearCloudBrowserSessionsSchema = z.object({
  generation: z.number().int().nonnegative(),
  cleanupPending: z.boolean(),
});

export const listWorkspaces = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  const workspaces = await env.WORKSPACES.getByName(userId).list();
  return { configured: configured(), workspaces: [...workspaces] };
});

export const getCloudBrowserSessions = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  return cloudBrowserSessionsSchema.parse(
    await env.WORKSPACES.getByName(userId).browserSessions(userId),
  );
});

export const clearCloudBrowserSessions = createServerFn({ method: "POST" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  return clearCloudBrowserSessionsSchema.parse(
    await env.WORKSPACES.getByName(userId).clearBrowserSessions(userId),
  );
});

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(createWorkspaceSchema)
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    if (!configured()) throw new Error("Workspace hosting has not been configured yet.");
    if (data.selection?.provider === "chatgpt")
      await requireChatGPTModel(env, userId, data.selection.model);
    const repository = await authorizeRepository(userId, data.repository);
    const workspace = await env.WORKSPACES.getByName(userId).start(userId, { ...data, repository });
    return { id: workspace.id };
  });

export const stopWorkspace = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    await env.WORKSPACES.getByName(userId).stop(data.id);
  });

export const agentCommand = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), command: agentCommandSchema }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    return JSON.stringify(await env.WORKSPACES.getByName(userId).agent(data.id, data.command));
  });

export const getTaskConversation = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    return JSON.stringify(await env.WORKSPACES.getByName(userId).conversation(data.id));
  });

export const resumeWorkspace = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    await env.WORKSPACES.getByName(userId).resume(data.id);
  });

export const workspaceViewCommand = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), command: workspaceViewCommandSchema }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    return JSON.stringify(
      await env.WORKSPACES.getByName(userId).view(
        data.id,
        data.command,
        new URL(getRequest().url).origin,
      ),
    );
  });
