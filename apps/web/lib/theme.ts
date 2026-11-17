// SPDX-License-Identifier: AGPL-3.0-only
// Appearance: the colour theme and the light or dark mode.
//
// Both are a matter of taste for one browser, not account data, so they live in a cookie
// rather than in the settings table. The server reads the cookie and writes the choice
// onto <html>, which means the first paint is already in the right colours. The values
// themselves are in app/globals.css.

export const THEMES = [
  { id: "indigo", label: "Indigo", swatch: "#5b50e6" },
  { id: "ink", label: "Ink", swatch: "#737373" },
  { id: "cobalt", label: "Cobalt", swatch: "#1d5fd6" },
  { id: "forest", label: "Forest", swatch: "#1f6b4a" },
  { id: "ocean", label: "Ocean", swatch: "#0b7285" },
  { id: "ember", label: "Ember", swatch: "#c64a17" },
  { id: "plum", label: "Plum", swatch: "#9c2f5e" },
] as const;

export const MODES = [
  { id: "system", label: "Match my device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ModeId = (typeof MODES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "indigo";
export const DEFAULT_MODE: ModeId = "system";

export const THEME_COOKIE = "aeyhey_theme";
export const MODE_COOKIE = "aeyhey_mode";

export function parseTheme(value: string | undefined): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME;
}

export function parseMode(value: string | undefined): ModeId {
  return MODES.find((mode) => mode.id === value)?.id ?? DEFAULT_MODE;
}

/**
 * The attributes for <html>. The defaults are left off altogether, so an instance nobody
 * has themed renders exactly the markup it did before themes existed.
 */
export function appearanceAttributes(theme: ThemeId, mode: ModeId): Record<string, string> {
  return {
    ...(theme === DEFAULT_THEME ? {} : { "data-theme": theme }),
    ...(mode === DEFAULT_MODE ? {} : { "data-mode": mode }),
  };
}

/** Applies a choice to the live page and remembers it for a year. Client only. */
export function applyAppearance(theme: ThemeId, mode: ModeId): void {
  const root = document.documentElement;

  if (theme === DEFAULT_THEME) delete root.dataset["theme"];
  else root.dataset["theme"] = theme;

  if (mode === DEFAULT_MODE) delete root.dataset["mode"];
  else root.dataset["mode"] = mode;

  const year = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${year}; samesite=lax`;
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=${year}; samesite=lax`;
}
