/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 * Format: `v1.<iv>.<authTag>.<ciphertext>` (base64url segments). Tokens never leave the backend.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.js";

const VERSION = "v1";
const SALT = "internflow-ai/token-encryption/v1";
const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = scryptSync(secret, SALT, 32);
    keyCache.set(secret, key);
  }
  return key;
}

export function encryptJson(value: unknown, secret: string = config.tokenEncryptionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Throws a generic error (no payload details) when the value was tampered with or the key changed. */
export function decryptJson<T>(payload: string, secret: string = config.tokenEncryptionKey): T {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Encrypted token payload is malformed");
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    throw new Error("Encrypted token payload could not be decrypted (tampered or wrong TOKEN_ENCRYPTION_KEY)");
  }
}
