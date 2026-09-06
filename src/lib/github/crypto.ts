const encoder = new TextEncoder();

export function randomSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );
}

export async function sha256(value: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!/^[a-f\d]{64}$/i.test(secret))
    throw new Error("GitHub encryption key must contain 32 random bytes encoded as hex.");
  const bytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(value: string, secret: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decrypt(value: string, secret: string, context: string): Promise<string> {
  const [iv, ciphertext, extra] = value.split(".");
  if (!iv || !ciphertext || extra) throw new Error("Invalid encrypted GitHub credentials.");
  const decoded = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
    await encryptionKey(secret),
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(decoded);
}
