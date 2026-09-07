import { expect, it } from "vitest";
import { requireBridgeCompatibility, WorkspaceBridgeVersionError } from "./protocol";

it("identifies bridges from before browser restoration support", async () => {
  await expect(
    requireBridgeCompatibility(new Response('{"error":"Not found"}', { status: 404 })),
  ).rejects.toBeInstanceOf(WorkspaceBridgeVersionError);
});

it("rejects an incompatible version without treating service outages as version mismatches", async () => {
  await expect(requireBridgeCompatibility(Response.json({ version: 0 }))).rejects.toBeInstanceOf(
    WorkspaceBridgeVersionError,
  );
  await expect(requireBridgeCompatibility(new Response(null, { status: 503 }))).rejects.toThrow(
    "Could not check the workspace service version",
  );
});
