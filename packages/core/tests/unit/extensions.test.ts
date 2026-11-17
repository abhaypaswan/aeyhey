// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  COMMUNITY_FLAGS,
  definePlugin,
  EditionMisconfiguredError,
  HOSTED_FLAGS,
  parseFeatureFlagOverrides,
  resolveEditionConfig,
} from "../../src/extensions/index";
import type { AuthProvider } from "../../src/extensions/auth";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import type { UsageGate, UsageSink } from "../../src/extensions/usage";

const stubAuth: AuthProvider = {
  id: "stub",
  async getUser() {
    return null;
  },
  async requireUser() {
    throw new Error("no user");
  },
  async signOut() {},
};

const stubKeys: AIKeyProvider = {
  id: "stub-keys",
  async resolve() {
    return { provider: "mock", model: "mock", source: "env" };
  },
};

const stubGate: UsageGate = {
  async check() {
    return { allow: true };
  },
};

const stubSink: UsageSink = {
  async record() {},
};

const defaults = { auth: stubAuth, aiKeys: stubKeys, usageGate: stubGate, usageSink: stubSink };

describe("feature flags", () => {
  it("defaults the community edition to single user with BYO keys and Ollama", () => {
    const config = resolveEditionConfig({ edition: "community" });
    expect(config.flags.multiUser).toBe(false);
    expect(config.flags.signUp).toBe(false);
    expect(config.flags.credits).toBe(false);
    expect(config.flags.byoKeys).toBe(true);
    expect(config.flags.ollama).toBe(true);
  });

  it("parses the FEATURE_FLAGS string and ignores names it does not know", () => {
    expect(parseFeatureFlagOverrides("byoKeys=false,ollama=true")).toEqual({
      byoKeys: false,
      ollama: true,
    });
    expect(parseFeatureFlagOverrides("nonsense=true")).toEqual({});
    expect(parseFeatureFlagOverrides(undefined)).toEqual({});
    expect(parseFeatureFlagOverrides("signUp")).toEqual({ signUp: true });
  });

  it("lets the environment override a plugin, so an operator always wins", () => {
    const config = resolveEditionConfig({
      edition: "community",
      pluginFlags: [{ byoKeys: false }],
      featureFlags: "byoKeys=true",
    });
    expect(config.flags.byoKeys).toBe(true);
  });

  it("takes demoMode from DEMO_MODE", () => {
    expect(resolveEditionConfig({ demoMode: true }).flags.demoMode).toBe(true);
  });

  it("keeps the community and hosted defaults distinct", () => {
    expect(COMMUNITY_FLAGS.credits).toBe(false);
    expect(HOSTED_FLAGS.credits).toBe(true);
    expect(HOSTED_FLAGS.ollama).toBe(false);
  });
});

describe("registry", () => {
  it("gives every interface a working community default (PRD 23.6)", () => {
    const registry = buildRegistry({ defaults });
    expect(registry.auth).toBeDefined();
    expect(registry.aiKeys).toBeDefined();
    expect(registry.usageGate).toBeDefined();
    expect(registry.usageSink).toBeDefined();
    expect(registry.config.edition).toBe("community");
    expect(registry.plugins).toHaveLength(0);
  });

  it("lets the last registered plugin win", () => {
    const first = definePlugin({ name: "first", auth: { ...stubAuth, id: "first-auth" } });
    const second = definePlugin({ name: "second", auth: { ...stubAuth, id: "second-auth" } });
    const registry = buildRegistry({ defaults, plugins: [first, second] });
    expect(registry.auth.id).toBe("second-auth");
  });

  it("keeps the community default when no plugin supplies one", () => {
    const partial = definePlugin({ name: "partial", usageGate: stubGate });
    const registry = buildRegistry({ defaults, plugins: [partial] });
    expect(registry.auth.id).toBe("stub");
  });

  it("refuses EDITION=hosted with no hosted plugin, rather than half starting", () => {
    expect(() => buildRegistry({ defaults, env: { EDITION: "hosted" } })).toThrow(
      EditionMisconfiguredError,
    );
  });

  it("names what is missing so the error is actionable", () => {
    const authOnly = definePlugin({ name: "auth-only", auth: stubAuth });
    try {
      buildRegistry({ defaults, plugins: [authOnly], env: { EDITION: "hosted" } });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("aiKeys");
      expect((error as Error).message).toContain("usageGate");
      expect((error as Error).message).not.toContain("auth,");
    }
  });

  it("accepts EDITION=hosted once a plugin provides the hosted pieces", () => {
    const hosted = definePlugin({
      name: "hosted",
      auth: stubAuth,
      aiKeys: stubKeys,
      usageGate: stubGate,
      usageSink: stubSink,
      flags: { credits: true },
    });
    const registry = buildRegistry({ defaults, plugins: [hosted], env: { EDITION: "hosted" } });
    expect(registry.config.edition).toBe("hosted");
    expect(registry.flag("credits")).toBe(true);
  });

  it("collects nav, settings tabs, api routes, jobs and migration dirs", () => {
    const plugin = definePlugin({
      name: "hosted",
      nav: [{ label: "Billing", href: "/billing" }],
      apiRoutes: [
        { method: "POST", path: "billing/webhook", handler: async () => new Response("ok") },
      ],
      jobs: [{ type: "settle_credits", handler: async () => {} }],
      migrationsDir: "/tmp/hosted-migrations",
    });
    const registry = buildRegistry({ defaults, plugins: [plugin] });
    expect(registry.nav).toHaveLength(1);
    expect(registry.apiRoutes[0]!.path).toBe("billing/webhook");
    expect(registry.jobs[0]!.type).toBe("settle_credits");
    expect(registry.pluginMigrations).toEqual([
      { plugin: plugin.name, dir: "/tmp/hosted-migrations" },
    ]);
  });

  it("runs every plugin's onStart", async () => {
    const started: string[] = [];
    const registry = buildRegistry({
      defaults,
      plugins: [
        definePlugin({ name: "a", onStart: async () => void started.push("a") }),
        definePlugin({ name: "b", onStart: async () => void started.push("b") }),
      ],
    });
    await registry.start();
    expect(started).toEqual(["a", "b"]);
  });
});
