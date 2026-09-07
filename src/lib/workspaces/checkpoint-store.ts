import type { CheckpointArchive } from "../../../bridge/contracts";
import type { SavedCheckpoint, SessionOwner } from "./session-store";

export interface CheckpointStore {
  put(owner: SessionOwner, archive: CheckpointArchive): Promise<SavedCheckpoint>;
  get(owner: SessionOwner, checkpoint: SavedCheckpoint): Promise<ReadableStream<Uint8Array>>;
  delete(checkpoint: SavedCheckpoint): Promise<void>;
}

export function createCheckpointStore(bucket: R2Bucket): CheckpointStore {
  return {
    async put(owner, archive) {
      const key = `tasks/${owner.taskId}/${archive.metadata.id}.tar.gz`;
      const fixed = new FixedLengthStream(archive.metadata.size);
      // R2 validates the digest before exposing the completed object. The DB pointer is saved later.
      await Promise.all([
        archive.body.pipeTo(fixed.writable),
        bucket.put(key, fixed.readable, {
          sha256: archive.metadata.sha256,
          httpMetadata: { contentType: "application/gzip" },
          customMetadata: {
            taskId: owner.taskId,
            userId: owner.userId,
            checkpoint: JSON.stringify(archive.metadata),
          },
        }),
      ]);
      return { key, metadata: archive.metadata };
    },
    async get(owner, checkpoint) {
      if (checkpoint.key !== `tasks/${owner.taskId}/${checkpoint.metadata.id}.tar.gz`)
        throw new Error("Saved workspace checkpoint does not belong to this task.");
      const object = await bucket.get(checkpoint.key);
      if (
        !object ||
        object.size !== checkpoint.metadata.size ||
        object.customMetadata?.taskId !== owner.taskId ||
        object.customMetadata?.userId !== owner.userId
      )
        throw new Error("Saved workspace checkpoint is missing or incomplete.");
      return object.body;
    },
    async delete(checkpoint) {
      await bucket.delete(checkpoint.key);
    },
  };
}
