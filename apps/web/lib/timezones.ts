// SPDX-License-Identifier: AGPL-3.0-only
// Every timezone the runtime knows, for the picker in Settings.
//
// The list comes from the JavaScript runtime's own IANA data (Intl.supportedValuesOf),
// so there is nothing to fetch, nothing to bundle and nothing to keep up to date by hand.
// It is built on the server and handed to the page, which keeps the server's list and
// the browser's from disagreeing.

export interface TimezoneOption {
  value: string;
  /** "Asia/Kolkata (GMT+5:30)". The offset is today's, so it follows daylight saving. */
  label: string;
}

function offsetOf(zone: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The options, A to Z. `current` is always among them, even if it is a name this runtime
 * no longer lists, so the picker can show what is saved rather than an empty field.
 */
export function timezoneOptions(current?: string, now = new Date()): TimezoneOption[] {
  const zones = new Set<string>(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (current) zones.add(current);

  return [...zones].sort().map((zone) => {
    const offset = offsetOf(zone, now);
    const name = zone.replaceAll("_", " ");
    return { value: zone, label: offset ? `${name} (${offset})` : name };
  });
}
