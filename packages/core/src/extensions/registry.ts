// SPDX-License-Identifier: AGPL-3.0-only
// The plugin registry (PRD 23.5).
//
// Community defaults are registered first, then each plugin from aeyhey.plugins.ts.
// Last registered wins. Feature code reads providers from here and never branches on
// the edition.

import type {
  AeyheyPlugin,
  NavItem,
  PluginApiRoute,
  PluginJob,
  SettingsTab,
  SlotName,
} from "./plugin";
import type { ComponentType } from "react";
import type { AuthProvider } from "./auth";
import type { AIKeyProvider } from "./ai-credentials";
import type { UsageGate, UsageSink } from "./usage";
import type { NativePushSender } from "./push-sender";
import type { EditionBrand, EditionConfig, FeatureFlags } from "./edition";
import { resolveEditionConfig } from "./edition";

export interface PluginMigrations {
  /** The plugin's name, which names its migration journal. */
  plugin: string;
  /** Absolute path to its migrations folder. */
  dir: string;
}

export interface RegistryDefaults {
  auth: AuthProvider;
  aiKeys: AIKeyProvider;
  usageGate: UsageGate;
  usageSink: UsageSink;
}

export interface RegistryInput {
  defaults: RegistryDefaults;
  plugins?: AeyheyPlugin[];
  env?: {
    EDITION?: string | undefined;
    DEMO_MODE?: boolean | undefined;
    FEATURE_FLAGS?: string | undefined;
  };
  brand?: EditionBrand | undefined;
  /**
   * Applied to whichever AuthProvider wins, community or plugin. Startup uses it to put
   * app tokens in front of every provider, so a plugin gets them without asking.
   */
  wrapAuth?: (auth: AuthProvider) => AuthProvider;
}

export interface Registry {
  readonly config: EditionConfig;
  readonly auth: AuthProvider;
  readonly aiKeys: AIKeyProvider;
  readonly usageGate: UsageGate;
  readonly usageSink: UsageSink;
  /** Null when no plugin sends to phones, which is the community default. */
  readonly pushSender: NativePushSender | null;
  readonly plugins: readonly AeyheyPlugin[];
  readonly nav: readonly NavItem[];
  readonly settingsTabs: readonly SettingsTab[];
  readonly apiRoutes: readonly PluginApiRoute[];
  readonly jobs: readonly PluginJob[];
  /** Each plugin's migrations, in plugin order, with the plugin's name for its journal. */
  readonly pluginMigrations: readonly PluginMigrations[];
  slot(name: SlotName): ComponentType | undefined;
  flag(name: keyof FeatureFlags): boolean;
  start(): Promise<void>;
}

export class EditionMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditionMisconfiguredError";
  }
}

let current: Registry | null = null;

export function buildRegistry(input: RegistryInput): Registry {
  const plugins = input.plugins ?? [];
  const env = input.env ?? {};

  const config = resolveEditionConfig({
    edition: env.EDITION,
    demoMode: env.DEMO_MODE,
    featureFlags: env.FEATURE_FLAGS,
    pluginFlags: plugins.map((p) => p.flags ?? {}),
    brand: input.brand,
  });

  // Fail fast rather than silently running a half-hosted app (PRD 23.1).
  if (config.edition === "hosted") {
    const missing: string[] = [];
    if (!plugins.some((p) => p.auth)) missing.push("auth");
    if (!plugins.some((p) => p.aiKeys)) missing.push("aiKeys");
    if (!plugins.some((p) => p.usageGate)) missing.push("usageGate");
    if (missing.length > 0) {
      throw new EditionMisconfiguredError(
        `EDITION=hosted needs a plugin that provides: ${missing.join(", ")}. ` +
          `Found ${plugins.length} plugin(s): ${plugins.map((p) => p.name).join(", ") || "none"}. ` +
          `The community build must run with EDITION=community.`,
      );
    }
  }

  const pick = <K extends keyof RegistryDefaults>(key: K): RegistryDefaults[K] => {
    let chosen = input.defaults[key];
    for (const plugin of plugins) {
      const candidate = plugin[key as keyof AeyheyPlugin];
      if (candidate) chosen = candidate as RegistryDefaults[K];
    }
    return chosen;
  };

  const slots = new Map<SlotName, ComponentType>();
  for (const plugin of plugins) {
    for (const [name, component] of Object.entries(plugin.slots ?? {})) {
      if (component) slots.set(name as SlotName, component as ComponentType);
    }
  }

  const registry: Registry = {
    config,
    auth: input.wrapAuth ? input.wrapAuth(pick("auth")) : pick("auth"),
    aiKeys: pick("aiKeys"),
    usageGate: pick("usageGate"),
    usageSink: pick("usageSink"),
    pushSender: plugins.reduce<NativePushSender | null>(
      (chosen, plugin) => plugin.pushSender ?? chosen,
      null,
    ),
    plugins,
    nav: plugins.flatMap((p) => p.nav ?? []),
    settingsTabs: plugins.flatMap((p) => p.settingsTabs ?? []),
    apiRoutes: plugins.flatMap((p) => p.apiRoutes ?? []),
    jobs: plugins.flatMap((p) => p.jobs ?? []),
    pluginMigrations: plugins.flatMap((p) =>
      p.migrationsDir ? [{ plugin: p.name, dir: p.migrationsDir }] : [],
    ),
    slot: (name) => slots.get(name),
    flag: (name) => config.flags[name],
    async start() {
      for (const plugin of plugins) {
        await plugin.onStart?.();
      }
    },
  };

  return registry;
}

export function setRegistry(registry: Registry): Registry {
  current = registry;
  return registry;
}

export function getRegistry(): Registry {
  if (!current) {
    throw new Error(
      "The extension registry is not initialised. Call initExtensions() during startup.",
    );
  }
  return current;
}

/** Test helper. Never call this from feature code. */
export function resetRegistryForTests(): void {
  current = null;
}
