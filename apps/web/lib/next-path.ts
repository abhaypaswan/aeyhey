// SPDX-License-Identifier: AGPL-3.0-only
// Where to go after signing in.
//
// Only a path on this site is accepted. "//evil.example" and "/\evil.example" are read by
// browsers as other hosts, so they are refused along with anything absolute.

export function safeNextPath(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  for (const char of value) {
    if (char.charCodeAt(0) < 0x20) return null;
  }
  return value;
}
