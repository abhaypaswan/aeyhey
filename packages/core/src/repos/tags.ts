// SPDX-License-Identifier: AGPL-3.0-only
// Tag storage, scoped by user (PRD 10).

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { newId } from "../ids";
import { normalizeTag } from "../links/tags";
import type { ItemType } from "../db/types";
import type { Scope } from "./context";

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

/** The user's most used tags. Fed to the AI prompt so it reuses them (PRD 8.1 FR-LINK-4). */
export async function topTags(scope: Scope, limit = 50): Promise<string[]> {
  const { tags, itemTags } = scope.handle.schema;

  const rows = await scope.handle.db
    .select({ name: tags.name, uses: sql<number>`count(${itemTags.tagId})`.as("uses") })
    .from(tags)
    .leftJoin(itemTags, eq(itemTags.tagId, tags.id))
    .where(eq(tags.userId, scope.userId))
    .groupBy(tags.id, tags.name)
    .orderBy(desc(sql`uses`), tags.name)
    .limit(limit);

  return rows.map((row) => row.name);
}

export async function listTags(scope: Scope): Promise<TagRow[]> {
  const { tags } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(tags)
    .where(eq(tags.userId, scope.userId))
    .orderBy(tags.name);
  return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }));
}

/**
 * Finds or creates each tag and returns their ids. Normalizes first, so two spellings of
 * the same tag can never both end up in the table.
 */
export async function ensureTags(scope: Scope, names: readonly string[]): Promise<TagRow[]> {
  const { tags } = scope.handle.schema;

  const normalized = [...new Set(names.map(normalizeTag).filter((n): n is string => n !== null))];
  if (normalized.length === 0) return [];

  const existing = await scope.handle.db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, scope.userId), inArray(tags.name, normalized)));

  const byName = new Map(existing.map((row) => [row.name, row]));
  const missing = normalized.filter((name) => !byName.has(name));

  if (missing.length > 0) {
    const toInsert = missing.map((name) => ({
      id: newId(),
      userId: scope.userId,
      name,
      createdAt: new Date(),
    }));
    // onConflictDoNothing covers the race where the worker and the web app create the
    // same tag at the same moment.
    await scope.handle.db.insert(tags).values(toInsert).onConflictDoNothing();

    const reread = await scope.handle.db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, scope.userId), inArray(tags.name, missing)));
    for (const row of reread) byName.set(row.name, row);
  }

  // Returned in the order they were asked for, which is the model's relevance order.
  return normalized
    .map((name) => byName.get(name))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ id: row.id, name: row.name, color: row.color }));
}

/** Replaces an item's tags with exactly this set. */
export async function setItemTags(
  scope: Scope,
  item: { type: ItemType; id: string },
  names: readonly string[],
): Promise<TagRow[]> {
  const { itemTags } = scope.handle.schema;
  const resolved = await ensureTags(scope, names);

  await scope.handle.db
    .delete(itemTags)
    .where(and(eq(itemTags.itemType, item.type), eq(itemTags.itemId, item.id)));

  if (resolved.length > 0) {
    await scope.handle.db
      .insert(itemTags)
      .values(
        resolved.map((tag) => ({
          userId: scope.userId,
          itemType: item.type,
          itemId: item.id,
          tagId: tag.id,
        })),
      )
      .onConflictDoNothing();
  }

  return resolved;
}

export async function addItemTags(
  scope: Scope,
  item: { type: ItemType; id: string },
  names: readonly string[],
): Promise<TagRow[]> {
  const { itemTags } = scope.handle.schema;
  const resolved = await ensureTags(scope, names);
  if (resolved.length === 0) return [];

  await scope.handle.db
    .insert(itemTags)
    .values(
      resolved.map((tag) => ({
        userId: scope.userId,
        itemType: item.type,
        itemId: item.id,
        tagId: tag.id,
      })),
    )
    .onConflictDoNothing();

  return resolved;
}

export async function removeItemTag(
  scope: Scope,
  item: { type: ItemType; id: string },
  name: string,
): Promise<void> {
  const { tags, itemTags } = scope.handle.schema;
  const normalized = normalizeTag(name);
  if (!normalized) return;

  const rows = await scope.handle.db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, scope.userId), eq(tags.name, normalized)))
    .limit(1);
  const tag = rows[0];
  if (!tag) return;

  await scope.handle.db
    .delete(itemTags)
    .where(
      and(
        eq(itemTags.itemType, item.type),
        eq(itemTags.itemId, item.id),
        eq(itemTags.tagId, tag.id),
      ),
    );
}

/** Tags for many items at once, so the inbox does not do a query per row. */
export async function tagsForItems(
  scope: Scope,
  type: ItemType,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const { tags, itemTags } = scope.handle.schema;
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;

  const rows = await scope.handle.db
    .select({ itemId: itemTags.itemId, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(
      and(
        eq(itemTags.userId, scope.userId),
        eq(itemTags.itemType, type),
        inArray(itemTags.itemId, [...ids]),
      ),
    )
    .orderBy(tags.name);

  for (const row of rows) {
    const list = out.get(row.itemId) ?? [];
    list.push(row.name);
    out.set(row.itemId, list);
  }
  return out;
}
