// SPDX-License-Identifier: AGPL-3.0-only
// ULID primary keys. Sortable by creation time, which keeps "newest first" queries cheap
// and makes a decimal id in a log readable at a glance.

import { ulid } from "ulid";

export function newId(at?: Date): string {
  return at ? ulid(at.getTime()) : ulid();
}

/**
 * A short, URL and Telegram friendly id. Telegram callback data is capped at 64 bytes,
 * so card ids get shortened on the way out and matched by prefix on the way back
 * (PRD 14.3).
 */
export function shortId(id: string): string {
  return id.slice(-10);
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
