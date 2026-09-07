const batchBytes = 1024 * 1024;

export async function transferCheckpoint(
  source: ReadableStream<Uint8Array>,
  destination: WritableStream<Uint8Array>,
  expectedBytes: number,
) {
  const reader = source.getReader();
  const writer = destination.getWriter();
  let received = 0;
  let buffered = 0;
  let batch = new Uint8Array(batchBytes);

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > expectedBytes)
        throw new Error("Checkpoint transfer exceeded its expected size.");

      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(batchBytes - buffered, next.value.byteLength - offset);
        batch.set(next.value.subarray(offset, offset + count), buffered);
        buffered += count;
        offset += count;

        if (buffered === batchBytes) {
          await writer.write(batch);
          batch = new Uint8Array(batchBytes);
          buffered = 0;
        }
      }
    }

    if (received !== expectedBytes) throw new Error("Checkpoint transfer is incomplete.");
    if (buffered) await writer.write(batch.subarray(0, buffered));
    await writer.close();
    return received;
  } catch (error) {
    await Promise.allSettled([writer.abort(error), reader.cancel(error)]);
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}
