// SPDX-License-Identifier: AGPL-3.0-only
// The repository layer (PRD 23.7).
//
// Community edition is single-user, but the code has to be multi-user correct, and the
// way to make that structural rather than a habit is to make it impossible to run a query
// without a user. Every function in src/repos takes a Scope, and Scope cannot be built
// without a userId. There is no "current user" global to forget to pass.
//
// If you find yourself wanting to query a user table outside this folder, add a function
// here instead.

import type { DbHandle } from "../db/client";

export interface Scope {
  readonly handle: DbHandle;
  readonly userId: string;
}

export function scopeFor(handle: DbHandle, userId: string): Scope {
  if (!userId) {
    throw new Error("A repository call needs a userId. Every query is scoped by user.");
  }
  return { handle, userId };
}

/** Cursor pagination, so the inbox stays fast with tens of thousands of links. */
export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` for the next page. Null when there is no more. */
  nextCursor: string | null;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(limit, MAX_PAGE_SIZE);
}

/**
 * Cursors are opaque to the caller on purpose: the UI must not build one by hand, because
 * then the ordering and the cursor shape could drift apart.
 */
export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
