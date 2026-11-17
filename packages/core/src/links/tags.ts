// SPDX-License-Identifier: AGPL-3.0-only
// Tag normalization and matching (PRD 8.1 FR-LINK-4).
//
// The problem this solves: a model asked to tag a hundred links will happily produce
// "Postgres", "postgres", "PostgreSQL", "postgres-db" and "databases" for the same idea,
// and then the tag filter is useless. So the prompt is given the user's existing tags to
// reuse, and whatever comes back is normalized and matched against them here before
// anything is written.
//
// Matching is deliberately conservative: exact match after normalizing, then simple
// singular and plural. Anything cleverer would eventually merge two tags the user meant
// to keep apart, and that is worse than a near-duplicate.

/** Lowercase kebab-case, which is the only shape a tag is ever stored in. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    // Strip a leading hash, which people type out of habit.
    .replace(/^#+/, "")
    // Accented characters are kept as-is: a Spanish or German tag should still work.
    .replace(/[\s_/\\.]+/g, "-")
    .replace(/[^\p{L}\p{N}+#-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (tag === "" || tag.length > 32) return null;
  // A tag of only digits is almost always a stray number from the page.
  if (/^\d+$/.test(tag)) return null;
  return tag;
}

/**
 * Crude but safe singular and plural forms. Only used to match against tags the user
 * already has, never to rewrite what they typed.
 */
function variants(tag: string): string[] {
  const forms = new Set<string>([tag]);

  if (tag.endsWith("ies") && tag.length > 4) forms.add(`${tag.slice(0, -3)}y`);
  else if (tag.endsWith("es") && tag.length > 3) forms.add(tag.slice(0, -2));
  if (tag.endsWith("s") && !tag.endsWith("ss") && tag.length > 2) forms.add(tag.slice(0, -1));

  if (tag.endsWith("y") && tag.length > 2) forms.add(`${tag.slice(0, -1)}ies`);
  if (!tag.endsWith("s")) {
    forms.add(`${tag}s`);
    forms.add(`${tag}es`);
  }

  return [...forms];
}

export interface TagMatchResult {
  /** The tag to use: an existing one when it matched, otherwise the normalized new one. */
  name: string;
  /** True when this reused a tag the user already had. */
  matchedExisting: boolean;
}

export function matchTag(raw: string, existing: readonly string[]): TagMatchResult | null {
  const normalized = normalizeTag(raw);
  if (!normalized) return null;

  const existingSet = new Set(existing);
  if (existingSet.has(normalized)) return { name: normalized, matchedExisting: true };

  // Try the normalized tag's other forms against what the user has.
  for (const form of variants(normalized)) {
    if (existingSet.has(form)) return { name: form, matchedExisting: true };
  }

  return { name: normalized, matchedExisting: false };
}

/**
 * Normalizes a whole set from one AI response: dedupes, matches against existing tags,
 * and caps the count. Order is kept, because the model puts the most relevant tag first.
 */
export function resolveTags(
  raw: readonly string[],
  existing: readonly string[],
  max = 5,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of raw) {
    const match = matchTag(candidate, existing);
    if (!match) continue;
    if (seen.has(match.name)) continue;
    seen.add(match.name);
    out.push(match.name);
    if (out.length >= max) break;
  }

  return out;
}

/** Shown as-is in the UI, so "machine-learning" reads as "Machine learning". */
export function tagLabel(tag: string): string {
  const words = tag.split("-");
  const first = words[0] ?? "";
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
}
