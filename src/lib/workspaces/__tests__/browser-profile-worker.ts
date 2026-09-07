import { z } from "zod";
import { browserProfileArchiveMetadataSchema } from "../../../../bridge/contracts";
import { createBrowserProfileStore } from "../browser-profile-store";

export const browserProbeOwnerSchema = z.object({
  userId: z.string().min(1),
  repositoryId: z.number().int().positive(),
});

export const browserProbeLeaseSchema = z.object({
  generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});

export const browserProbeProfileSchema = browserProbeLeaseSchema.extend({
  key: z.string(),
  repositoryId: z.number().int().positive(),
  repositoryName: z.string(),
  metadata: browserProfileArchiveMetadataSchema,
  encryptedSize: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export const browserProbeSeedSchema = z.object({
  lease: browserProbeLeaseSchema,
  profile: browserProbeProfileSchema.nullable(),
});

const ownerRequest = z.object({ owner: browserProbeOwnerSchema });
const publishRequest = ownerRequest.extend({
  lease: browserProbeLeaseSchema,
  value: z.string(),
});

export const browserProbeRequestSchema = z.discriminatedUnion("action", [
  ownerRequest.extend({ action: z.literal("seed") }),
  ownerRequest.extend({ action: z.literal("clear") }),
  ownerRequest.extend({ action: z.literal("cleanup") }),
  ownerRequest.extend({ action: z.literal("list") }),
  ownerRequest.extend({
    action: z.literal("read"),
    profile: browserProbeProfileSchema,
  }),
  publishRequest.extend({ action: z.literal("publish") }),
  publishRequest.extend({ action: z.literal("publish_incomplete") }),
  publishRequest.extend({ action: z.literal("publish_slow"), token: z.uuid() }),
  ownerRequest.extend({ action: z.literal("upload_pending"), token: z.uuid() }),
  z.object({ action: z.literal("release"), token: z.uuid() }),
]);

export type BrowserProbeRequest = z.infer<typeof browserProbeRequestSchema>;
export type BrowserProbeOwner = z.infer<typeof browserProbeOwnerSchema>;
export type BrowserProbeLease = z.infer<typeof browserProbeLeaseSchema>;

interface BrowserProbeEnvironment {
  DB: D1Database;
  PROFILES: R2Bucket;
}

const releases = new Map<string, () => void>();

export default {
  async fetch(request: Request, environment: BrowserProbeEnvironment) {
    const store = createBrowserProfileStore(environment.DB, environment.PROFILES, "11".repeat(32));

    try {
      const input = browserProbeRequestSchema.parse(await request.json());
      if (input.action === "release") {
        releases.get(input.token)?.();
        releases.delete(input.token);
        return Response.json({ released: true });
      }
      if (input.action === "upload_pending") {
        const row = z
          .object({ count: z.number() })
          .parse(
            await environment.DB.prepare(
              "SELECT COUNT(*) count FROM browser_profile_cleanup WHERE user_id = ?",
            )
              .bind(input.owner.userId)
              .first(),
          );
        return Response.json({ pending: releases.has(input.token) && row.count > 0 });
      }
      if (input.action === "seed")
        return Response.json(await store.seed(input.owner, "fixture/project"));
      if (input.action === "clear") return Response.json(await store.clear(input.owner.userId));
      if (input.action === "cleanup")
        return Response.json({ pending: await store.cleanup(input.owner.userId) });
      if (input.action === "list") return Response.json(await store.list(input.owner.userId));
      if (input.action === "read") {
        const bytes = await new Response(
          await store.read(input.owner, input.profile),
        ).arrayBuffer();
        return new Response(bytes);
      }

      const bytes = new TextEncoder().encode(input.value);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const metadata = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        size: bytes.byteLength + (input.action === "publish_incomplete" ? 1 : 0),
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      };
      const body =
        input.action === "publish_slow"
          ? new ReadableStream<Uint8Array>({
              start(controller) {
                releases.set(input.token, () => {
                  controller.enqueue(bytes);
                  controller.close();
                });
              },
            })
          : new Blob([bytes]).stream();
      return Response.json(
        await store.publish(input.owner, "fixture/project", input.lease, { metadata, body }),
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Browser profile request failed." },
        { status: 400 },
      );
    }
  },
};
