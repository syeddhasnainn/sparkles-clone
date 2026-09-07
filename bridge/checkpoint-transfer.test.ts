import { describe, expect, it, vi } from "vitest";
import { transferCheckpoint } from "./checkpoint-transfer";

function source(bytes: Uint8Array, chunkSize: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

describe("checkpoint transfer", () => {
  it.each([16384, 65536, 1500000])(
    "batches %i-byte chunks without changing archive bytes",
    async (chunkSize) => {
      const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 + 37 }, (_, i) => i % 251);
      const chunks: Uint8Array[] = [];
      const close = vi.fn();
      const destination = new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk);
        },
        close,
      });

      expect(await transferCheckpoint(source(bytes, chunkSize), destination, bytes.length)).toBe(
        bytes.length,
      );
      expect(chunks.map((chunk) => chunk.length)).toEqual([1048576, 1048576, 37]);
      expect(Buffer.compare(Buffer.concat(chunks), Buffer.from(bytes))).toBe(0);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it.each([9, 11])("rejects a size mismatch against %i expected bytes", async (expectedBytes) => {
    const abort = vi.fn();
    const close = vi.fn();
    const destination = new WritableStream<Uint8Array>({ abort, close });

    await expect(
      transferCheckpoint(source(new Uint8Array(10), 3), destination, expectedBytes),
    ).rejects.toThrow(/expected size|incomplete/);
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("cancels the source and releases locks when the destination fails", async () => {
    const cancel = vi.fn();
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel,
    });
    const output = new WritableStream<Uint8Array>({
      write() {
        throw new Error("Upload failed");
      },
    });

    await expect(transferCheckpoint(input, output, 2 * 1024 * 1024)).rejects.toThrow(
      "Upload failed",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.locked).toBe(false);
    expect(output.locked).toBe(false);
  });
});
