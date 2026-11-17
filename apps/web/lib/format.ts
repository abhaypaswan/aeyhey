// SPDX-License-Identifier: AGPL-3.0-only
// Small formatting helpers for the UI. Plain words, no em dashes.

export function relativeDate(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const days = Math.round((now - then) / 86_400_000);

  if (days <= 0) return "saved today";
  if (days === 1) return "saved yesterday";
  if (days < 30) return `saved ${days} days ago`;
  if (days < 60) return "saved last month";
  if (days < 365) return `saved ${Math.round(days / 30)} months ago`;
  if (days < 730) return "saved last year";
  return `saved ${Math.round(days / 365)} years ago`;
}

export function tagLabel(tag: string): string {
  const words = tag.split("-");
  const first = words[0] ?? "";
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function pluralize(count: number, one: string, many?: string): string {
  return count === 1 ? `${count} ${one}` : `${count} ${many ?? `${one}s`}`;
}

/**
 * A label such as "Tomorrow at 09:00" placed mid-sentence: "today" and "tomorrow" go lower
 * case, while day and month names ("Tuesday 1 December") keep their capitals.
 */
export function midSentence(label: string): string {
  return /^(Today|Tomorrow)\b/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;
}
