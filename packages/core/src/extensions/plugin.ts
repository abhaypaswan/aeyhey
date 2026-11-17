// SPDX-License-Identifier: AGPL-3.0-only
// Plugin and overlay mechanism (PRD 23.5).

import type { ComponentType } from "react";
import type { AuthProvider } from "./auth";
import type { AIKeyProvider } from "./ai-credentials";
import type { UsageGate, UsageSink } from "./usage";
import type { FeatureFlags } from "./edition";
import type { NativePushSender } from "./push-sender";

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  position?: "main" | "settings" | "account";
}

export interface SettingsTab {
  id: string;
  label: string;
  component: ComponentType;
}

/**
 * Named places inside public pages where a plugin may render its own component.
 * Add a new name here, in the public repo, before the hosted edition can use it.
 */
export type SlotName = "header.right" | "today.banner" | "settings.ai.top" | "session.end";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface PluginApiRoute {
  method: HttpMethod;
  /** Mounted under /api/ext. A path of "billing/webhook" serves /api/ext/billing/webhook. */
  path: string;
  handler: (req: Request) => Promise<Response>;
}

export interface PluginJob {
  type: string;
  handler: (payload: unknown) => Promise<void>;
}

export interface AeyheyPlugin {
  name: string;
  auth?: AuthProvider;
  aiKeys?: AIKeyProvider;
  usageGate?: UsageGate;
  usageSink?: UsageSink;
  /** Sends reminders to phone apps. Last registered wins. */
  pushSender?: NativePushSender;
  flags?: Partial<FeatureFlags>;
  nav?: NavItem[];
  settingsTabs?: SettingsTab[];
  slots?: Partial<Record<SlotName, ComponentType>>;
  apiRoutes?: PluginApiRoute[];
  jobs?: PluginJob[];
  /**
   * Absolute path to the plugin's own migrations. Run after the public ones, with a
   * journal of their own named after the plugin, so renaming a plugin re-runs them.
   */
  migrationsDir?: string;
  onStart?(): Promise<void>;
}

export function definePlugin(p: AeyheyPlugin): AeyheyPlugin {
  return p;
}
