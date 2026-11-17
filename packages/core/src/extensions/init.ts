// SPDX-License-Identifier: AGPL-3.0-only
// Startup wiring. The app calls this once, hands it the plugin list from
// aeyhey.plugins.ts, and from then on every module reads providers off the registry.

import { buildRegistry, setRegistry, type Registry } from "./registry";
import type { AeyheyPlugin } from "./plugin";
import { createLocalSingleUserAuth } from "./defaults/local-auth";
import { createEnvAndUserKeyProvider } from "./defaults/env-user-keys";
import { createAllowAllGate } from "./defaults/allow-all-gate";
import { createLocalUsageSink } from "./defaults/local-usage-sink";
import { withApiTokens } from "./api-tokens";
import type { DbHandle } from "../db/client";
import type { Env } from "../env";
import { ensureAppSecret } from "../security/crypto";
import { createLogger } from "../logger";

const log = createLogger("extensions");

export interface InitExtensionsInput {
  handle: DbHandle;
  env: Env;
  plugins?: AeyheyPlugin[];
}

export interface InitExtensionsResult {
  registry: Registry;
  appSecret: string;
}

export async function initExtensions(input: InitExtensionsInput): Promise<InitExtensionsResult> {
  const { handle, env } = input;

  const appSecret = ensureAppSecret({ dataDir: env.DATA_DIR, fromEnv: env.APP_SECRET });

  const registry = buildRegistry({
    defaults: {
      auth: createLocalSingleUserAuth({
        handle,
        appSecret,
        authMode: env.AUTH_MODE,
        publicUrl: env.PUBLIC_URL,
      }),
      aiKeys: createEnvAndUserKeyProvider({ handle, env, appSecret }),
      usageGate: createAllowAllGate({ requestsPerMinute: env.AI_RPM }),
      usageSink: createLocalUsageSink(handle),
    },
    plugins: input.plugins ?? [],
    wrapAuth: (auth) => withApiTokens(auth, { handle }),
    env: {
      EDITION: env.EDITION,
      DEMO_MODE: env.DEMO_MODE,
      FEATURE_FLAGS: env.FEATURE_FLAGS,
    },
  });

  setRegistry(registry);
  await registry.start();

  log.info("extensions ready", {
    edition: registry.config.edition,
    auth: registry.auth.id,
    aiKeys: registry.aiKeys.id,
    plugins: registry.plugins.map((p) => p.name),
  });

  return { registry, appSecret };
}
