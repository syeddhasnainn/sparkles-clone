import { z } from "zod";
import { githubCredentialsSchema } from "./github-credentials.ts";
import { projectEnvironmentSchema } from "./project-environment.ts";
import { agentSelectionSchema, reasoningEffortSchema } from "./agent-selection.ts";
import type { AgentSelection } from "./agent-selection.ts";
import { permissionModeSchema, permissionModesSchema } from "./permission-modes.ts";
import {
  workspaceViewCommandSchema,
  workspaceViewResultSchema,
} from "./workspace-view-contracts.ts";

export const workspaceIdleTimeoutMs = 10 * 60_000;
export const workspaceLifetimeMs = 60 * 60 * 1000;
export const checkpointIntervalMs = 60_000;
export const checkpointGraceMs = 300_000;
export const maximumCheckpointBytes = 512 * 1024 * 1024;
export const browserProfileDirectory = "/tmp/sparkles-browser-profile";
export const maximumBrowserProfileBytes = 16 * 1024 * 1024;
export const maximumExpandedBrowserProfileBytes = 128 * 1024 * 1024;
export const sandboxNameSchema = z.string().regex(/^sparkles-[a-f0-9-]{36}$/);

export const repositorySchema = z.object({
  id: z.number().int().positive(),
  installationId: z.number().int().positive(),
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  defaultBranch: z.string().min(1).max(255),
});

export const createWorkspaceSchema = z.object({
  selection: agentSelectionSchema.optional(),
  requestId: z.uuid(),
  prompt: z.string().trim().min(1).max(20_000),
  repository: repositorySchema,
});

export const agentCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("events"), cursor: z.number().int().nonnegative().default(0) }),
  z.object({
    kind: z.literal("prompt"),
    requestId: z.uuid(),
    prompt: z.string().trim().min(1).max(20_000),
  }),
  z.object({ kind: z.literal("cancel") }),
  z.object({ kind: z.literal("set_permission_mode"), modeId: permissionModeSchema }),
  z.object({ kind: z.literal("permission"), id: z.uuid(), optionId: z.string().min(1).max(256) }),
]);
export const agentEventSchema = z.object({
  timestamp: z.number().int().positive().optional(),
  id: z.number().int().positive(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export const agentStatusSchema = z.enum([
  "starting",
  "idle",
  "running",
  "checkpointing",
  "failed",
  "stopped",
  "interrupted",
]);
export const agentSnapshotSchema = z.object({
  permissionModes: permissionModesSchema.optional(),
  status: agentStatusSchema,
  sessionId: z.string().nullable().optional(),
  events: z.array(agentEventSchema),
  cursor: z.number().int().nonnegative(),
  head: z.number().int().nonnegative().optional(),
});
export const checkpointMetadataSchema = z.object({
  id: z.uuid(),
  sessionId: z.string().min(1),
  cursor: z.number().int().nonnegative(),
  createdAt: z.number().int().positive(),
  size: z.number().int().positive().max(maximumCheckpointBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  interrupted: z.boolean(),
});
export const checkpointRequestSchema = z.object({ name: sandboxNameSchema, id: z.uuid() });
export const restoreRequestSchema = z.object({
  name: sandboxNameSchema,
  checkpoint: checkpointMetadataSchema,
  cursor: z.number().int().nonnegative(),
});
export const browserProfileArchiveMetadataSchema = z.object({
  id: z.uuid(),
  createdAt: z.number().int().positive(),
  size: z.number().int().positive().max(maximumBrowserProfileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const browserProfileCaptureRequestSchema = z.object({
  name: sandboxNameSchema,
  id: z.uuid(),
});
export const browserProfileRestoreRequestSchema = z.object({
  name: sandboxNameSchema,
  profile: browserProfileArchiveMetadataSchema,
});
export const browserProfileResetRequestSchema = z.object({ name: sandboxNameSchema });
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CheckpointMetadata = z.infer<typeof checkpointMetadataSchema>;
export type CheckpointRequest = z.infer<typeof checkpointRequestSchema>;
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;
export type BrowserProfileArchiveMetadata = z.infer<typeof browserProfileArchiveMetadataSchema>;
export type BrowserProfileCaptureRequest = z.infer<typeof browserProfileCaptureRequestSchema>;
export type BrowserProfileRestoreRequest = z.infer<typeof browserProfileRestoreRequestSchema>;
export type BrowserProfileResetRequest = z.infer<typeof browserProfileResetRequestSchema>;
export interface CheckpointArchive {
  metadata: CheckpointMetadata;
  body: ReadableStream<Uint8Array>;
}
export interface BrowserProfileArchive {
  metadata: BrowserProfileArchiveMetadata;
  body: ReadableStream<Uint8Array>;
}
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentSnapshot = z.infer<typeof agentSnapshotSchema>;

export const modelGatewaySchema = z.object({
  permissionMode: permissionModeSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  agent: z.enum(["opencode", "codex"]).optional(),
  provider: z.enum(["openrouter", "chatgpt"]).optional(),
  url: z.url(),
  token: z.string().min(1).max(256),
  model: z.string().min(1),
});

export const bridgeRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("view"),
    name: sandboxNameSchema,
    command: workspaceViewCommandSchema,
    commit: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .nullable(),
    expiresAt: z.number(),
    parentOrigin: z.url(),
  }),
  z.object({
    action: z.literal("create"),
    projectEnvironment: projectEnvironmentSchema.optional(),
    gateway: modelGatewaySchema.optional(),
    github: githubCredentialsSchema.optional(),
    name: sandboxNameSchema,
    repository: repositorySchema,
    token: z.string().min(1).max(2048),
  }),
  z.object({
    action: z.literal("agent"),
    name: sandboxNameSchema,
    command: agentCommandSchema,
  }),
  z.object({
    action: z.literal("sync"),
    name: sandboxNameSchema,
    cursor: z.number().int().nonnegative(),
    acknowledge: z.number().int().nonnegative().optional(),
  }),
  z.object({
    action: z.enum(["allocate", "start", "stop", "status"]),
    repository: repositorySchema.optional(),
    projectEnvironment: projectEnvironmentSchema.optional(),
    gateway: modelGatewaySchema.optional(),
    github: githubCredentialsSchema.optional(),
    name: sandboxNameSchema,
  }),
]);

export const bridgeResponseSchema = z.object({
  view: workspaceViewResultSchema.optional(),
  agent: agentSnapshotSchema.optional(),
  running: z.boolean(),
  sandboxId: z.string().nullable(),
  commit: z.string().nullable(),
});

export type Repository = z.infer<typeof repositorySchema>;
export type CreateWorkspace = z.infer<typeof createWorkspaceSchema>;
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;

export interface Workspace {
  activity?: WorkspaceActivity;
  selection?: AgentSelection;
  id: string;
  prompt: string;
  repository: Repository;
  status: "provisioning" | "ready" | "stopping" | "stopped" | "failed";
  phase?: "sandbox" | "checkout" | "agent" | "task";
  createdAt: number;
  expiresAt: number;
  sandboxId: string | null;
  commit: string | null;
  error: string | null;
  checkpointAt?: number | null;
  browserSessionError?: string | null;
  canResume?: boolean;
  restoring?: boolean;
}

export interface DiffSummary {
  additions: number;
  deletions: number;
  partial?: boolean;
}

export interface PullRequestSummary extends DiffSummary {
  number: number;
  state: "open" | "draft" | "merged" | "closed";
}

export interface WorkspaceActivity {
  changes?: DiffSummary;
  pullRequest?: PullRequestSummary;
}
