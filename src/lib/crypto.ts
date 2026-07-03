import crypto from "node:crypto";
import { env } from "./env";

// AES-256-GCM encryption for secrets stored in Postgres (schedule tokens,
// per-system PBX secrets, push trigger tokens). Ciphertext format:
//   base64( iv[12] | authTag[16] | ciphertext )   prefixed with "enc:v1:".

const PREFIX = "enc:v1:";

function key(): Buffer {
  const raw = env.encryptionKey();
  // Accept hex (64 chars) or base64; must decode to 32 bytes.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must decode to 32 bytes (hex or base64). Generate with: openssl rand -base64 32",
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) {
    // Not encrypted (e.g. legacy/plaintext) — return as-is.
    return value;
  }
  const data = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Encrypt only if a value is present; leave null/empty untouched.
export function maybeEncrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

export function maybeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  return decrypt(value);
}
