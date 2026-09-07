import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireGitHubUser } from "../github/service.server";
import { createChatGPTService } from "./service";

export const getChatGPTConnection = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  return createChatGPTService(env).status(userId);
});
export const startChatGPTConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  return createChatGPTService(env).start(userId);
});
export const pollChatGPTConnection = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    return createChatGPTService(env).poll(userId, data.id);
  });
export const cancelChatGPTConnection = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const { userId } = await requireGitHubUser();
    await createChatGPTService(env).cancel(userId, data.id);
  });
export const disconnectChatGPTConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { userId } = await requireGitHubUser();
  await createChatGPTService(env).disconnect(userId);
});
