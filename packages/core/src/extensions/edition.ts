// SPDX-License-Identifier: AGPL-3.0-only
// Edition and feature flags (PRD 23.1).
//
// EDITION only picks defaults. Real behavior comes from which providers are registered,
// so setting EDITION=hosted in the public repo alone does nothing useful: the registry
// fails fast at startup when the hosted providers are missing.

export type Edition = "community" | "hosted";

export interface FeatureFlags {
  /** More than one account in one database. Community: false. */
  multiUser: boolean;
  /** A public sign-up screen. Community: false. */
  signUp: boolean;
  /** Users may enter their own AI keys. Community: true. Hosted: configurable. */
  byoKeys: boolean;
  /** Ollama is offered as a provider. Community: true. Hosted: false. */
  ollama: boolean;
  /** A credits balance gates AI calls. Community: false. */
  credits: boolean;
  /** Users may bring their own Telegram bot token. Community: true. */
  customTelegramBot: boolean;
  /** Seed data and the mock AI provider. Comes from DEMO_MODE. */
  demoMode: boolean;
}

export interface EditionBrand {
  name: string;
  supportUrl?: string;
}

export interface EditionConfig {
  edition: Edition;
  flags: FeatureFlags;
  brand?: EditionBrand;
}

export const COMMUNITY_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  multiUser: false,
  signUp: false,
  byoKeys: true,
  ollama: true,
  credits: false,
  customTelegramBot: true,
  demoMode: false,
});

export const HOSTED_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  multiUser: true,
  signUp: true,
  byoKeys: true,
  ollama: false,
  credits: true,
  customTelegramBot: false,
  demoMode: false,
});

const FLAG_NAMES = Object.keys(COMMUNITY_FLAGS) as (keyof FeatureFlags)[];

/**
 * Parses FEATURE_FLAGS, a comma separated list such as "byoKeys=false,ollama=true".
 * Unknown names are ignored on purpose so an old env file does not break a new build.
 */
export function parseFeatureFlagOverrides(raw: string | undefined): Partial<FeatureFlags> {
  if (!raw) return {};
  const out: Partial<FeatureFlags> = {};
  for (const pair of raw.split(",")) {
    const [rawName, rawValue] = pair.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    if (!FLAG_NAMES.includes(name as keyof FeatureFlags)) continue;
    const value = (rawValue ?? "true").trim().toLowerCase();
    out[name as keyof FeatureFlags] = value === "true" || value === "1" || value === "yes";
  }
  return out;
}

export function resolveEditionConfig(input: {
  edition?: string | undefined;
  demoMode?: boolean | undefined;
  featureFlags?: string | undefined;
  pluginFlags?: Partial<FeatureFlags>[];
  brand?: EditionBrand | undefined;
}): EditionConfig {
  const edition: Edition = input.edition === "hosted" ? "hosted" : "community";
  const base = edition === "hosted" ? HOSTED_FLAGS : COMMUNITY_FLAGS;

  // Order, weakest first: edition defaults, then each plugin, then the env override.
  // The env always wins so an operator can turn something off without a code change.
  let flags: FeatureFlags = { ...base, demoMode: input.demoMode ?? false };
  for (const partial of input.pluginFlags ?? []) {
    flags = { ...flags, ...partial };
  }
  flags = { ...flags, ...parseFeatureFlagOverrides(input.featureFlags) };

  return input.brand ? { edition, flags, brand: input.brand } : { edition, flags };
}
