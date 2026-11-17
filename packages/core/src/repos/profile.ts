// SPDX-License-Identifier: AGPL-3.0-only
// Your name and picture: what the app, the web and your public page show for you.
//
// The picture arrives as a data URL, already cropped square and shrunk by the client.
// The server never trusts the type the client names: it reads the first bytes, keeps
// only JPEG, PNG and WebP (never SVG, which can carry script), and caps the size.

import { eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { Scope } from "./context";

/**
 * Plenty for a shrunk square: the web sends a 512 pixel JPEG, the app a 320 pixel PNG.
 * Anything bigger was not shrunk first.
 */
export const AVATAR_MAX_BYTES = 512 * 1024;

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

/** What a picture's first bytes say it is, or null when it is none we keep. */
export function sniffImage(bytes: Uint8Array): AvatarMime | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a
  ) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type AvatarProblem = "not_image" | "too_large";

/** Reads a data URL into bytes and their real type, or says what is wrong with it. */
export function parseAvatar(
  dataUrl: string,
): { mime: AvatarMime; bytes: Uint8Array } | { problem: AvatarProblem } {
  const match = /^data:[\w/+.-]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return { problem: "not_image" };
  const bytes = new Uint8Array(Buffer.from(match[1]!, "base64"));
  if (bytes.length > AVATAR_MAX_BYTES) return { problem: "too_large" };
  const mime = sniffImage(bytes);
  if (!mime) return { problem: "not_image" };
  return { mime, bytes };
}

export async function setDisplayName(scope: Scope, name: string): Promise<void> {
  const { users } = scope.handle.schema;
  await scope.handle.db.update(users).set({ displayName: name }).where(eq(users.id, scope.userId));
}

export async function saveAvatar(
  scope: Scope,
  avatar: { mime: AvatarMime; bytes: Uint8Array },
): Promise<void> {
  const { userAvatars } = scope.handle.schema;
  const row = {
    mime: avatar.mime,
    data: Buffer.from(avatar.bytes).toString("base64"),
    updatedAt: new Date(),
  };
  await scope.handle.db
    .insert(userAvatars)
    .values({ userId: scope.userId, ...row })
    .onConflictDoUpdate({ target: userAvatars.userId, set: row });
}

export async function removeAvatar(scope: Scope): Promise<void> {
  const { userAvatars } = scope.handle.schema;
  await scope.handle.db.delete(userAvatars).where(eq(userAvatars.userId, scope.userId));
}

/** The stored picture, for serving. Takes a user id so the public page can use it too. */
export async function loadAvatar(
  handle: DbHandle,
  userId: string,
): Promise<{ mime: AvatarMime; bytes: Buffer; updatedAt: Date } | null> {
  const { userAvatars } = handle.schema;
  const rows = await handle.db
    .select()
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    mime: row.mime as AvatarMime,
    bytes: Buffer.from(row.data, "base64"),
    updatedAt: row.updatedAt,
  };
}

/** When the picture last changed, as a cache key for its URL, or null with none. */
export async function avatarVersion(handle: DbHandle, userId: string): Promise<number | null> {
  const { userAvatars } = handle.schema;
  const rows = await handle.db
    .select({ updatedAt: userAvatars.updatedAt })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  return rows[0] ? rows[0].updatedAt.getTime() : null;
}

/** Where the signed-in person's own picture is served, changing whenever it does. */
export async function ownAvatarUrl(handle: DbHandle, userId: string): Promise<string | null> {
  const version = await avatarVersion(handle, userId);
  return version === null ? null : `/api/profile/avatar?v=${version}`;
}
