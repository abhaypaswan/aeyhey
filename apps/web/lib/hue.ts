// SPDX-License-Identifier: AGPL-3.0-only
// Colours for telling things apart, the way the phone app picks them.
//
// A deck, a site or a tag always gets the same one of six hues, chosen by hashing its id
// or host, so it is recognisable across screens and on the phone too. Red and amber are
// left out of that rotation because they mean "careful". The hues themselves are the
// --color-hue-* tokens in app/globals.css.

export type Hue = "orange" | "blue" | "violet" | "green" | "pink" | "teal" | "amber" | "red";

const FOR_KEYS: Hue[] = ["orange", "blue", "violet", "green", "pink", "teal"];

/** The same hash as the phone's AppHue.forKey, so both pick the same colour. */
export function hueFor(key: string): Hue {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) & 0x7fffffff;
  }
  return FOR_KEYS[hash % FOR_KEYS.length] ?? "blue";
}

/** The strong colour of a hue, for text, icons and solid fills. */
export function strong(hue: Hue): string {
  return `var(--color-hue-${hue})`;
}

/**
 * `color` mixed into `base` by a different amount in light and dark mode, as the phone's
 * lerp(base, color, t) does. Both sides are colours, so light-dark() picks one.
 */
export function mix(base: string, color: string, light: number, dark: number): string {
  const side = (t: number): string =>
    `color-mix(in srgb, ${base}, ${color} ${Math.round(t * 1000) / 10}%)`;
  return `light-dark(${side(light)}, ${side(dark)})`;
}

/** The soft ground of a hue: a wash of it on a card. */
export function soft(hue: Hue): string {
  return mix("var(--color-surface)", strong(hue), 0.12, 0.18);
}

/** The host of a URL without "www.", for picking a site's hue and letter. */
export function siteKey(url: string, siteName?: string | null): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return siteName ?? url;
  }
}
