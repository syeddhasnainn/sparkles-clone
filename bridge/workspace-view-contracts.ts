import { z } from "zod";

const filePath = z.string().max(2048);
export const workspaceViewCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("files"),
    scope: z.enum(["changed", "all"]),
    base: z.enum(["task", "head"]),
  }),
  z.object({ kind: z.literal("file"), path: filePath, base: z.enum(["task", "head"]) }),
  z.object({ kind: z.literal("services") }),
  z.object({
    kind: z.literal("preview-start"),
    command: z.string().trim().min(1).max(2000),
    port: z.number().int().min(1024).max(65535),
  }),
  z.object({ kind: z.literal("preview-stop") }),
  z.object({ kind: z.literal("desktop-start") }),
  z.object({
    kind: z.literal("connect"),
    service: z.enum(["preview", "desktop"]),
    path: z.string().max(2048).optional(),
  }),
]);

const service = z.object({
  status: z.enum(["stopped", "starting", "ready", "failed"]),
  log: z.string(),
});
export const workspaceViewResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({
    kind: z.literal("files"),
    files: z.array(
      z.object({
        path: filePath,
        status: z.enum(["added", "modified", "deleted", "unchanged"]),
        additions: z.number().nullable(),
        deletions: z.number().nullable(),
      }),
    ),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("file"),
    path: filePath,
    before: z.string().nullable(),
    after: z.string().nullable(),
    binary: z.boolean(),
    image: z.string().nullable(),
    tooLarge: z.boolean(),
  }),
  z.object({
    kind: z.literal("services"),
    preview: service.extend({ command: z.string(), port: z.number(), managed: z.boolean() }),
    desktop: service,
  }),
  z.object({
    kind: z.literal("connect"),
    url: z.url(),
    expiresAt: z.number(),
    service: z.enum(["preview", "desktop"]),
  }),
]);

export type WorkspaceViewCommand = z.infer<typeof workspaceViewCommandSchema>;
export type WorkspaceViewResult = z.infer<typeof workspaceViewResultSchema>;
export type WorkspaceFiles = Extract<WorkspaceViewResult, { kind: "files" }>;
export type WorkspaceFile = Extract<WorkspaceViewResult, { kind: "file" }>;
export type WorkspaceServices = Extract<WorkspaceViewResult, { kind: "services" }>;
