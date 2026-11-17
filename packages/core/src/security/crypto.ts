// SPDX-License-Identifier: AGPL-3.0-only
// Secret material: APP_SECRET, derived keys, API key encryption (PRD 17, 25).
//
// APP_SECRET is generated on first run and written to DATA_DIR/secrets.json with mode
// 0600, outside the repo. Keys entered in the UI are encrypted with AES-256-GCM using a
// key derived from APP_SECRET through HKDF, so one leaked database row is not a key.

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GeneratedSecrets {
  appSecret: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
}

const SECRETS_FILE = "secrets.json";

export function secretsPath(dataDir: string): string {
  return join(dataDir, SECRETS_FILE);
}

function writeSecrets(path: string, secrets: GeneratedSecrets): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies the mode when creating the file, so set it either way.
  chmodSync(path, 0o600);
}

export function readSecretsFile(dataDir: string): GeneratedSecrets | null {
  const path = secretsPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GeneratedSecrets;
  } catch {
    return null;
  }
}

/**
 * Returns the app secret, generating and persisting one on first run.
 * An APP_SECRET in the environment always wins and is never written to disk.
 */
export function ensureAppSecret(input: { dataDir: string; fromEnv?: string | undefined }): string {
  if (input.fromEnv && input.fromEnv.length >= 32) return input.fromEnv;
  if (input.fromEnv && input.fromEnv.length > 0) {
    throw new Error(
      "APP_SECRET is too short. Use at least 32 characters, or leave it empty and let Aeyhey generate one.",
    );
  }

  const existing = readSecretsFile(input.dataDir);
  if (existing?.appSecret) return existing.appSecret;

  const appSecret = randomBytes(48).toString("base64url");
  writeSecrets(secretsPath(input.dataDir), { ...(existing ?? {}), appSecret });
  return appSecret;
}

export function saveGeneratedSecrets(dataDir: string, patch: Partial<GeneratedSecrets>): void {
  const existing = readSecretsFile(dataDir);
  if (!existing?.appSecret && !patch.appSecret) {
    throw new Error("Cannot save secrets before the app secret exists.");
  }
  writeSecrets(secretsPath(dataDir), { ...(existing ?? {}), ...patch } as GeneratedSecrets);
}

/**
 * Derives a purpose-bound 32 byte key from the app secret. Different purposes give
 * different keys, so a token signing key can never decrypt a stored API key.
 */
export function deriveKey(appSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret, "aeyhey", purpose, 32));
}

const ENC_PREFIX = "v1";

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plaintext: string, appSecret: string): string {
  const key = deriveKey(appSecret, "api-keys");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, appSecret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== ENC_PREFIX) {
    throw new Error("That stored secret is not in a format this version understands.");
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const key = deriveKey(appSecret, "api-keys");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
