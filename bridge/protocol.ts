import { z } from "zod";

export const bridgeProtocolVersion = 2;
export const bridgeCapabilitiesSchema = z.object({ version: z.literal(bridgeProtocolVersion) });

export class WorkspaceBridgeVersionError extends Error {
  constructor() {
    super("The workspace service is out of date. Restart or update the bridge before resuming.");
    this.name = "WorkspaceBridgeVersionError";
  }
}

export async function requireBridgeCompatibility(response: Response) {
  if (response.status === 404) throw new WorkspaceBridgeVersionError();
  if (!response.ok) throw new Error("Could not check the workspace service version.");
  const capabilities = bridgeCapabilitiesSchema.safeParse(await response.json());
  if (!capabilities.success) throw new WorkspaceBridgeVersionError();
}
