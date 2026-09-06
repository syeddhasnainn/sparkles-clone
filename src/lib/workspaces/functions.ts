import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { agentCommandSchema, createWorkspaceSchema } from "../../../bridge/contracts";
import { requireGitHubUser } from "../github/service.server";
import { authorizeRepository } from "./github.server";
import { workspaceViewCommandSchema } from "../../../bridge/workspace-view-contracts";

function configured() {
  return Boolean(
    env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY,
  );
}

export const listWorkspaces = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  return { configured: configured(), workspaces: await env.WORKSPACES.getByName(userId).list() };
});

export const createWorkspace = createServerFn({ method: "POST" })
  .validator(createWorkspaceSchema)
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    if (!configured()) throw new Error("Workspace hosting has not been configured yet.");
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
