import { z } from "zod";

const chunkBytes = 512 * 1024;
const tagBytes = 16;
const frameHeaderBytes = 4;
const archiveHeader = new TextEncoder().encode("SPBRv001");
const secretSchema = z.string().regex(/^[a-f\d]{64}$/i);

export interface BrowserProfileCryptographicContext {
  userId: string;
  repositoryId: number;
  generation: number;
  revision: number;
  id: string;
  size: number;
  sha256: string;
}

const bytesFromHex = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));

async function encryptionKey(secret: string, context: BrowserProfileCryptographicContext) {
  const material = await crypto.subtle.importKey(
    "raw",
    bytesFromHex(secretSchema.parse(secret)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("sparkles-browser-profile-encryption-v1"),
      info: new TextEncoder().encode(
        JSON.stringify({ purpose: "browser-profile-archive-v1", ...context }),
      ),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const chunkCount = (size: number) => Math.ceil(size / chunkBytes);

export const encryptedBrowserProfileSize = (size: number) =>
  archiveHeader.byteLength + 8 + size + chunkCount(size) * (frameHeaderBytes + tagBytes);

function nonce(base: Uint8Array, index: number) {
  const result = new Uint8Array(12);
  result.set(base);
  new DataView(result.buffer).setUint32(8, index);
  return result;
}

function additionalData(context: BrowserProfileCryptographicContext, index: number) {
  return new TextEncoder().encode(
    JSON.stringify({
      purpose: "sparkles-browser-profile-v1",
      ...context,
      chunks: chunkCount(context.size),
      index,
    }),
  );
}

async function* sourceChunks(source: ReadableStream<Uint8Array>, expected: number) {
  const reader = source.getReader();
  let received = 0;
  let buffered = 0;
  let batch = new Uint8Array(chunkBytes);

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > expected) throw new Error("Browser profile exceeded its expected size.");

      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(chunkBytes - buffered, next.value.byteLength - offset);
        batch.set(next.value.subarray(offset, offset + count), buffered);
        buffered += count;
        offset += count;
        if (buffered === chunkBytes) {
          yield batch;
          batch = new Uint8Array(chunkBytes);
          buffered = 0;
        }
      }
    }
    if (received !== expected) throw new Error("Browser profile transfer is incomplete.");
    if (buffered) yield batch.subarray(0, buffered);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function generatorStream(
  generator: AsyncGenerator<Uint8Array>,
  source: ReadableStream<Uint8Array>,
) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await generator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await generator.return(undefined);
      if (!source.locked) await source.cancel().catch(() => {});
    },
  });
}

export function encryptBrowserProfile(
  source: ReadableStream<Uint8Array>,
  secret: string,
  context: BrowserProfileCryptographicContext,
) {
  const output = async function* () {
    const key = await encryptionKey(secret, context);
    const base = crypto.getRandomValues(new Uint8Array(8));
    const header = new Uint8Array(archiveHeader.byteLength + base.byteLength);
    header.set(archiveHeader);
    header.set(base, archiveHeader.byteLength);
    yield header;

    let index = 0;
    for await (const chunk of sourceChunks(source, context.size)) {
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: nonce(base, index),
            additionalData: additionalData(context, index),
          },
          key,
          chunk,
        ),
      );
      const frame = new Uint8Array(frameHeaderBytes + ciphertext.byteLength);
      new DataView(frame.buffer).setUint32(0, chunk.byteLength);
      frame.set(ciphertext, frameHeaderBytes);
      yield frame;
      index += 1;
    }
  };

  return generatorStream(output(), source);
}

class StreamReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffered = new Uint8Array();
  private closed = false;

  constructor(source: ReadableStream<Uint8Array>) {
    this.reader = source.getReader();
  }

  async read(bytes: number) {
    while (this.buffered.byteLength < bytes) {
      const next = await this.reader.read();
      if (next.done) throw new Error("Encrypted browser profile is incomplete.");
      const combined = new Uint8Array(this.buffered.byteLength + next.value.byteLength);
      combined.set(this.buffered);
      combined.set(next.value, this.buffered.byteLength);
      this.buffered = combined;
    }
    const result = this.buffered.slice(0, bytes);
    this.buffered = this.buffered.slice(bytes);
    return result;
  }

  async finish() {
    const next = await this.reader.read();
    if (this.buffered.byteLength || !next.done)
      throw new Error("Encrypted browser profile contains trailing bytes.");
    this.reader.releaseLock();
    this.closed = true;
  }

  async cancel() {
    if (this.closed) return;
    await this.reader.cancel().catch(() => {});
    this.reader.releaseLock();
    this.closed = true;
  }
}

export function decryptBrowserProfile(
  source: ReadableStream<Uint8Array>,
  secret: string,
  context: BrowserProfileCryptographicContext,
) {
  const output = async function* () {
    const reader = new StreamReader(source);
    try {
      const header = await reader.read(archiveHeader.byteLength + 8);
      if (!archiveHeader.every((byte, index) => header[index] === byte))
        throw new Error("Encrypted browser profile has an invalid header.");
      const base = header.slice(archiveHeader.byteLength);
      const key = await encryptionKey(secret, context);
      let remaining = context.size;

      for (let index = 0; index < chunkCount(context.size); index++) {
        const lengthHeader = await reader.read(frameHeaderBytes);
        const length = new DataView(lengthHeader.buffer).getUint32(0);
        const expected = Math.min(chunkBytes, remaining);
        if (length !== expected) throw new Error("Encrypted browser profile has an invalid frame.");
        const ciphertext = await reader.read(length + tagBytes);
        yield new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: nonce(base, index),
              additionalData: additionalData(context, index),
            },
            key,
            ciphertext,
          ),
        );
        remaining -= length;
      }
      await reader.finish();
    } finally {
      await reader.cancel();
    }
  };

  return generatorStream(output(), source);
}
