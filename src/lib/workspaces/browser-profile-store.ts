import { z } from "zod";
import { browserProfileArchiveMetadataSchema } from "../../../bridge/contracts";
import type { BrowserProfileArchive } from "../../../bridge/contracts";
import {
  decryptBrowserProfile,
  encryptedBrowserProfileSize,
  encryptBrowserProfile,
} from "./browser-profile-crypto";

export interface BrowserProfileOwner {
  userId: string;
  repositoryId: number;
}

export interface BrowserProfileLease {
  generation: number;
  revision: number;
}

export interface SavedBrowserProfile extends BrowserProfileLease {
  key: string;
  repositoryId: number;
  repositoryName: string;
  metadata: z.infer<typeof browserProfileArchiveMetadataSchema>;
  encryptedSize: number;
  updatedAt: number;
}

export interface BrowserProfileSeed {
  lease: BrowserProfileLease;
  profile: SavedBrowserProfile | null;
}

export interface BrowserProfileStore {
  seed(owner: BrowserProfileOwner, repositoryName: string): Promise<BrowserProfileSeed>;
  publish(
    owner: BrowserProfileOwner,
    repositoryName: string,
    expected: BrowserProfileLease,
    archive: BrowserProfileArchive,
  ): Promise<SavedBrowserProfile>;
  read(
    owner: BrowserProfileOwner,
    profile: SavedBrowserProfile,
  ): Promise<ReadableStream<Uint8Array>>;
  list(userId: string): Promise<SavedBrowserProfile[]>;
  clear(userId: string): Promise<{ generation: number; cleanupPending: boolean }>;
  cleanup(userId: string): Promise<boolean>;
  error(owner: BrowserProfileOwner, message: string | null): Promise<void>;
}

export class BrowserProfileConflictError extends Error {}

const stateRowSchema = z.object({
  generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  repository_name: z.string(),
  object_key: z.string().nullable(),
  archive_id: z.string().nullable(),
  archive_size: z.number().int().positive().nullable(),
  archive_sha256: z.string().nullable(),
  encrypted_size: z.number().int().positive().nullable(),
  updated_at: z.number().int().positive().nullable(),
});

const cleanupRowSchema = z.object({ object_key: z.string() });

const savedProfile = (owner: BrowserProfileOwner, row: z.infer<typeof stateRowSchema>) => {
  if (
    !row.object_key ||
    !row.archive_id ||
    !row.archive_size ||
    !row.archive_sha256 ||
    !row.encrypted_size ||
    !row.updated_at
  )
    return null;

  return {
    key: row.object_key,
    repositoryId: owner.repositoryId,
    repositoryName: row.repository_name,
    generation: row.generation,
    revision: row.revision,
    metadata: browserProfileArchiveMetadataSchema.parse({
      id: row.archive_id,
      createdAt: row.updated_at,
      size: row.archive_size,
      sha256: row.archive_sha256,
    }),
    encryptedSize: row.encrypted_size,
    updatedAt: row.updated_at,
  } satisfies SavedBrowserProfile;
};

const ownerSchema = z.object({
  userId: z.string().min(1),
  repositoryId: z.number().int().positive(),
});

export function createBrowserProfileStore(
  db: Pick<D1Database, "prepare" | "batch">,
  bucket: R2Bucket,
  secret: string,
): BrowserProfileStore {
  const ownerHash = async (userId: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  const ensure = async (ownerInput: BrowserProfileOwner, repositoryName: string) => {
    const owner = ownerSchema.parse(ownerInput);
    await db.batch([
      db
        .prepare(
          "INSERT INTO browser_profile_generations(user_id, generation) VALUES (?, 0) ON CONFLICT(user_id) DO NOTHING",
        )
        .bind(owner.userId),
      db
        .prepare(
          "INSERT INTO browser_profiles(user_id, repository_id, repository_name, generation) SELECT ?, ?, ?, generation FROM browser_profile_generations WHERE user_id = ? ON CONFLICT(user_id, repository_id) DO UPDATE SET repository_name = excluded.repository_name",
        )
        .bind(owner.userId, owner.repositoryId, repositoryName, owner.userId),
    ]);
    return owner;
  };

  const state = async (owner: BrowserProfileOwner) => {
    const row = await db
      .prepare(
        "SELECT g.generation, CASE WHEN p.generation = g.generation THEN p.revision ELSE 0 END revision, p.repository_name, CASE WHEN p.generation = g.generation THEN p.object_key END object_key, CASE WHEN p.generation = g.generation THEN p.archive_id END archive_id, CASE WHEN p.generation = g.generation THEN p.archive_size END archive_size, CASE WHEN p.generation = g.generation THEN p.archive_sha256 END archive_sha256, CASE WHEN p.generation = g.generation THEN p.encrypted_size END encrypted_size, CASE WHEN p.generation = g.generation THEN p.updated_at END updated_at FROM browser_profile_generations g JOIN browser_profiles p ON p.user_id = g.user_id WHERE g.user_id = ? AND p.repository_id = ?",
      )
      .bind(owner.userId, owner.repositoryId)
      .first();
    return stateRowSchema.parse(row);
  };

  const rememberCleanup = async (userId: string, key: string, delayMs = 0) => {
    const now = Date.now();
    await db
      .prepare(
        "INSERT INTO browser_profile_cleanup(object_key, user_id, created_at, delete_after) VALUES (?, ?, ?, ?) ON CONFLICT(object_key) DO UPDATE SET delete_after = MIN(browser_profile_cleanup.delete_after, excluded.delete_after)",
      )
      .bind(key, userId, now, now + delayMs)
      .run();
  };

  const deleteObject = async (userId: string, key: string) => {
    try {
      await bucket.delete(key);
      await db.prepare("DELETE FROM browser_profile_cleanup WHERE object_key = ?").bind(key).run();
      return true;
    } catch {
      await rememberCleanup(userId, key);
      return false;
    }
  };

  return {
    async seed(ownerInput, repositoryName) {
      const owner = await ensure(ownerInput, repositoryName);
      const row = await state(owner);
      return {
        lease: { generation: row.generation, revision: row.revision },
        profile: savedProfile(owner, row),
      };
    },
    async publish(ownerInput, repositoryName, expected, archive) {
      const owner = await ensure(ownerInput, repositoryName);
      const before = await state(owner);
      if (before.generation !== expected.generation || before.revision !== expected.revision) {
        await archive.body.cancel().catch(() => {});
        throw new BrowserProfileConflictError(
          "A newer cloud-browser session has already been saved for this project.",
        );
      }
      const previous = savedProfile(owner, before);
      if (
        previous &&
        previous.metadata.size === archive.metadata.size &&
        previous.metadata.sha256 === archive.metadata.sha256
      ) {
        await archive.body.cancel().catch(() => {});
        return previous;
      }

      const revision = expected.revision + 1;
      const hashedOwner = await ownerHash(owner.userId);
      const key = `browser-profiles/${hashedOwner}/${owner.repositoryId}/${expected.generation}/${revision}-${archive.metadata.id}.bin`;
      const context = {
        ...owner,
        generation: expected.generation,
        revision,
        ...archive.metadata,
      };
      const encryptedSize = encryptedBrowserProfileSize(archive.metadata.size);
      await rememberCleanup(owner.userId, key, 5 * 60_000);
      try {
        const fixed = new FixedLengthStream(encryptedSize);
        await Promise.all([
          encryptBrowserProfile(archive.body, secret, context).pipeTo(fixed.writable),
          bucket.put(key, fixed.readable, {
            httpMetadata: { contentType: "application/octet-stream" },
            customMetadata: {
              format: "sparkles-browser-profile-v1",
              ownerHash: hashedOwner,
              repositoryId: String(owner.repositoryId),
              generation: String(expected.generation),
              revision: String(revision),
              archive: JSON.stringify(archive.metadata),
            },
          }),
        ]);
      } catch (error) {
        await deleteObject(owner.userId, key);
        throw error;
      }

      let results: D1Result[];
      try {
        results = await db.batch([
          db
            .prepare(
              "INSERT INTO browser_profile_cleanup(object_key, user_id, created_at, delete_after) SELECT object_key, user_id, ?, ? FROM browser_profiles WHERE user_id = ? AND repository_id = ? AND generation = ? AND revision = ? AND object_key IS NOT NULL AND generation = (SELECT generation FROM browser_profile_generations WHERE user_id = ?) ON CONFLICT(object_key) DO UPDATE SET delete_after = MIN(browser_profile_cleanup.delete_after, excluded.delete_after)",
            )
            .bind(
              Date.now(),
              Date.now(),
              owner.userId,
              owner.repositoryId,
              expected.generation,
              expected.revision,
              owner.userId,
            ),
          db
            .prepare(
              "UPDATE browser_profiles SET repository_name = ?, generation = ?, revision = ?, object_key = ?, archive_id = ?, archive_size = ?, archive_sha256 = ?, encrypted_size = ?, updated_at = ?, last_error = NULL WHERE user_id = ? AND repository_id = ? AND generation = ? AND revision = ? AND generation = (SELECT generation FROM browser_profile_generations WHERE user_id = ?)",
            )
            .bind(
              repositoryName,
              expected.generation,
              revision,
              key,
              archive.metadata.id,
              archive.metadata.size,
              archive.metadata.sha256,
              encryptedSize,
              archive.metadata.createdAt,
              owner.userId,
              owner.repositoryId,
              expected.generation,
              expected.revision,
              owner.userId,
            ),
          db
            .prepare(
              "DELETE FROM browser_profile_cleanup WHERE object_key = ? AND EXISTS (SELECT 1 FROM browser_profiles WHERE user_id = ? AND repository_id = ? AND object_key = ?)",
            )
            .bind(key, owner.userId, owner.repositoryId, key),
        ]);
      } catch (error) {
        await rememberCleanup(owner.userId, key);
        try {
          if ((await state(owner)).object_key !== key) await deleteObject(owner.userId, key);
        } catch {
          await rememberCleanup(owner.userId, key);
        }
        throw error;
      }
      if (!results[1].meta.changes) {
        await deleteObject(owner.userId, key);
        throw new BrowserProfileConflictError(
          "A newer cloud-browser session has already been saved for this project.",
        );
      }
      if (before.object_key) await deleteObject(owner.userId, before.object_key);
      return {
        key,
        repositoryId: owner.repositoryId,
        repositoryName,
        generation: expected.generation,
        revision,
        metadata: archive.metadata,
        encryptedSize,
        updatedAt: archive.metadata.createdAt,
      };
    },
    async read(ownerInput, profile) {
      const owner = ownerSchema.parse(ownerInput);
      const hashedOwner = await ownerHash(owner.userId);
      if (
        owner.repositoryId !== profile.repositoryId ||
        profile.key !==
          `browser-profiles/${hashedOwner}/${owner.repositoryId}/${profile.generation}/${profile.revision}-${profile.metadata.id}.bin`
      )
        throw new Error("Saved cloud-browser session does not belong to this project.");
      const object = await bucket.get(profile.key);
      if (
        !object ||
        object.size !== profile.encryptedSize ||
        object.customMetadata?.format !== "sparkles-browser-profile-v1" ||
        object.customMetadata?.ownerHash !== hashedOwner ||
        object.customMetadata?.repositoryId !== String(owner.repositoryId) ||
        object.customMetadata?.generation !== String(profile.generation) ||
        object.customMetadata?.revision !== String(profile.revision) ||
        object.customMetadata?.archive !== JSON.stringify(profile.metadata)
      )
        throw new Error("Saved cloud-browser session is missing or incomplete.");
      const current = await state(owner);
      if (
        current.generation !== profile.generation ||
        current.revision !== profile.revision ||
        current.object_key !== profile.key
      )
        throw new Error("Saved cloud-browser session changed before it could be restored.");
      return decryptBrowserProfile(object.body, secret, {
        ...owner,
        generation: profile.generation,
        revision: profile.revision,
        ...profile.metadata,
      });
    },
    async list(userId) {
      const rows = await db
        .prepare(
          "SELECT g.generation, p.revision, p.repository_id, p.repository_name, p.object_key, p.archive_id, p.archive_size, p.archive_sha256, p.encrypted_size, p.updated_at FROM browser_profiles p JOIN browser_profile_generations g ON g.user_id = p.user_id AND g.generation = p.generation WHERE p.user_id = ? AND p.object_key IS NOT NULL ORDER BY p.updated_at DESC",
        )
        .bind(userId)
        .all();
      return rows.results.map((value) => {
        const repository = z.object({ repository_id: z.number().int().positive() }).parse(value);
        const owner = { userId, repositoryId: repository.repository_id };
        const profile = savedProfile(owner, stateRowSchema.parse(value));
        if (!profile) throw new Error("Saved cloud-browser session metadata is incomplete.");
        return profile;
      });
    },
    async clear(userId) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO browser_profile_generations(user_id, generation) VALUES (?, 0) ON CONFLICT(user_id) DO NOTHING",
          )
          .bind(userId),
        db
          .prepare(
            "UPDATE browser_profile_generations SET generation = generation + 1 WHERE user_id = ?",
          )
          .bind(userId),
        db
          .prepare(
            "INSERT INTO browser_profile_cleanup(object_key, user_id, created_at, delete_after) SELECT object_key, user_id, ?, ? FROM browser_profiles WHERE user_id = ? AND object_key IS NOT NULL ON CONFLICT(object_key) DO UPDATE SET delete_after = MIN(browser_profile_cleanup.delete_after, excluded.delete_after)",
          )
          .bind(Date.now(), Date.now(), userId),
        db
          .prepare(
            "UPDATE browser_profiles SET generation = (SELECT generation FROM browser_profile_generations WHERE user_id = ?), revision = 0, object_key = NULL, archive_id = NULL, archive_size = NULL, archive_sha256 = NULL, encrypted_size = NULL, updated_at = NULL, last_error = NULL WHERE user_id = ?",
          )
          .bind(userId, userId),
      ]);
      const generation = z
        .object({ generation: z.number().int().nonnegative() })
        .parse(
          await db
            .prepare("SELECT generation FROM browser_profile_generations WHERE user_id = ?")
            .bind(userId)
            .first(),
        ).generation;
      return { generation, cleanupPending: await this.cleanup(userId) };
    },
    async cleanup(userId) {
      const rows = await db
        .prepare(
          "SELECT object_key FROM browser_profile_cleanup WHERE user_id = ? AND delete_after <= ? ORDER BY delete_after LIMIT 100",
        )
        .bind(userId, Date.now())
        .all();
      const results = await Promise.all(
        rows.results.map(async (value) => {
          const key = cleanupRowSchema.parse(value).object_key;
          const referenced = await db
            .prepare("SELECT object_key FROM browser_profiles WHERE object_key = ?")
            .bind(key)
            .first();
          if (referenced) {
            await db
              .prepare("DELETE FROM browser_profile_cleanup WHERE object_key = ?")
              .bind(key)
              .run();
            return true;
          }
          return deleteObject(userId, key);
        }),
      );
      if (results.some((deleted) => !deleted)) return true;
      const remaining = z
        .object({ count: z.number().int().nonnegative() })
        .parse(
          await db
            .prepare("SELECT COUNT(*) count FROM browser_profile_cleanup WHERE user_id = ?")
            .bind(userId)
            .first(),
        );
      return remaining.count > 0;
    },
    async error(ownerInput, message) {
      const owner = ownerSchema.parse(ownerInput);
      await db
        .prepare(
          "UPDATE browser_profiles SET last_error = ? WHERE user_id = ? AND repository_id = ?",
        )
        .bind(message, owner.userId, owner.repositoryId)
        .run();
    },
  };
}
