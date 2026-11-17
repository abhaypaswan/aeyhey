// SPDX-License-Identifier: AGPL-3.0-only
// Near-duplicate question detection (PRD 8.2 FR-Q-4).
//
// Generating questions twice from the same topic produces the same questions worded
// slightly differently, and a deck full of those is worse than a short deck. Exact string
// matching catches none of them, so we compare character trigrams with Jaccard
// similarity, which is cheap, needs no model, and is stable across runs.
//
// Trigrams rather than words because the rewording is usually at the word level:
// "How would you index this table?" and "How do you index this table?" share almost every
// trigram but differ in two words. Embedding-based dedupe is v1.1 (PRD 19).

/** Above this, two questions are the same question (PRD 8.2 FR-Q-4). */
export const SIMILARITY_THRESHOLD = 0.8;

/**
 * Normalizes away everything that is not the substance of the question: case,
 * punctuation, and the polite framing that models vary between runs.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(
      /\b(?:can|could|would|will|do|does|did|you|your|please|tell me|explain|describe|walk me through)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function trigrams(text: string): Set<string> {
  const normalized = normalizeQuestion(text);
  // Padding makes the start and end of the string count, so two questions that differ
  // only at the beginning are not treated as identical.
  const padded = `  ${normalized} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Intersection over union, 0 to 1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  // Walk the smaller set, so this is O(min) rather than O(max).
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const gram of small) {
    if (large.has(gram)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

export function similarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

export function isNearDuplicate(a: string, b: string, threshold = SIMILARITY_THRESHOLD): boolean {
  // An identical question after normalizing is a duplicate whatever the threshold says.
  if (normalizeQuestion(a) === normalizeQuestion(b)) return true;
  return similarity(a, b) >= threshold;
}

export interface DedupeResult<T> {
  kept: T[];
  /** What was dropped, and what it duplicated, so the UI can say why. */
  dropped: { item: T; duplicateOf: string; score: number }[];
}

/**
 * Keeps the first of each group of near-duplicates. Order matters: the caller passes
 * existing questions first, so a new question that repeats an old one is the one dropped.
 */
export function dedupeQuestions<T extends { text: string }>(
  candidates: readonly T[],
  existing: readonly string[] = [],
  threshold = SIMILARITY_THRESHOLD,
): DedupeResult<T> {
  const kept: T[] = [];
  const dropped: DedupeResult<T>["dropped"] = [];

  // Trigrams are computed once per text, not once per comparison.
  const seen: { text: string; grams: Set<string> }[] = existing.map((text) => ({
    text,
    grams: trigrams(text),
  }));

  for (const candidate of candidates) {
    const grams = trigrams(candidate.text);
    const normalized = normalizeQuestion(candidate.text);

    let match: { text: string; score: number } | null = null;
    for (const prior of seen) {
      if (normalizeQuestion(prior.text) === normalized) {
        match = { text: prior.text, score: 1 };
        break;
      }
      const score = jaccard(grams, prior.grams);
      if (score >= threshold) {
        match = { text: prior.text, score };
        break;
      }
    }

    if (match) {
      dropped.push({ item: candidate, duplicateOf: match.text, score: match.score });
      continue;
    }

    kept.push(candidate);
    seen.push({ text: candidate.text, grams });
  }

  return { kept, dropped };
}
