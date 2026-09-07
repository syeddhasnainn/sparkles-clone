import { z } from "zod";

export const permissionModeSchema = z.enum(["read-only", "agent", "agent-full-access"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionModesSchema = z.object({
  currentModeId: permissionModeSchema,
  availableModes: z.array(z.object({ id: permissionModeSchema })),
});
export type PermissionModes = z.infer<typeof permissionModesSchema>;

export const permissionModeOptions = [
  {
    id: "read-only",
    name: "Standard",
    description: "Workspace edits allowed; asks for restricted actions",
  },
  {
    id: "agent",
    name: "Auto",
    description: "Codex reviews approvals and asks when an action needs your decision",
  },
  {
    id: "agent-full-access",
    name: "Full access",
    description: "Run commands and access the network inside this workspace without asking",
  },
] satisfies { id: PermissionMode; name: string; description: string }[];
