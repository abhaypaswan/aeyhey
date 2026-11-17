// SPDX-License-Identifier: AGPL-3.0-only
// Keeps the public build honest (PRD 23.6).
//
// Two things must stay true in this repo, and a grep over the source is not a reliable
// way to check either. So we import the real files and look at the real values.

import { describe, expect, it } from "vitest";
import plugins from "../aeyhey.plugins";
import { buildRegistry, COMMUNITY_FLAGS } from "@aeyhey/core/extensions";
import type { AuthProvider, AIKeyProvider, UsageGate, UsageSink } from "@aeyhey/core/extensions";

describe("the community app registers no plugins", () => {
  it("exports an empty plugin list", () => {
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toHaveLength(0);
  });
});

describe("every extension point has a working community default", () => {
  // Stand-ins for what runtime.ts builds. The point of this test is the registry's
  // behaviour with zero plugins, not the specific implementations.
  const auth: AuthProvider = {
    id: "local-single-user",
    async getUser() {
      return null;
    },
    async requireUser() {
      throw new Error("no user");
    },
    async signOut() {},
  };
  const aiKeys: AIKeyProvider = {
    id: "env-and-user-keys",
    async resolve() {
      return { provider: "mock", model: "mock", source: "env" };
    },
  };
  const usageGate: UsageGate = {
    async check() {
      return { allow: true };
    },
  };
  const usageSink: UsageSink = { async record() {} };

  it("builds a registry with no plugins and every provider present", () => {
    const registry = buildRegistry({
      defaults: { auth, aiKeys, usageGate, usageSink },
      plugins,
      env: { EDITION: "community" },
    });

    expect(registry.config.edition).toBe("community");
    expect(registry.auth.id).toBe("local-single-user");
    expect(registry.aiKeys.id).toBe("env-and-user-keys");
    expect(registry.usageGate).toBeDefined();
    expect(registry.usageSink).toBeDefined();
    expect(registry.apiRoutes).toHaveLength(0);
    expect(registry.pluginMigrations).toHaveLength(0);
  });

  it("leaves the hosted-only features off", () => {
    const registry = buildRegistry({
      defaults: { auth, aiKeys, usageGate, usageSink },
      plugins,
      env: { EDITION: "community" },
    });

    expect(registry.flag("credits")).toBe(false);
    expect(registry.flag("signUp")).toBe(false);
    expect(registry.flag("multiUser")).toBe(false);
    // The things a self-hoster must keep.
    expect(registry.flag("byoKeys")).toBe(true);
    expect(registry.flag("ollama")).toBe(true);
    expect(registry.flag("customSmtp")).toBe(true);
    expect(COMMUNITY_FLAGS.credits).toBe(false);
  });
});
