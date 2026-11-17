// SPDX-License-Identifier: AGPL-3.0-only
// Process-wide startup, shared by the web app and the worker.
//
// Opens the database, runs migrations, builds the extension registry from
// aeyhey.plugins.ts, and in demo mode seeds the sample data. Everything downstream reads
// providers off the registry, never off the environment.

import { closeDb, getDb, type DbHandle } from "@aeyhey/core/db";
import { runMigrations } from "@aeyhey/core/db";
import { initExtensions, type Registry } from "@aeyhey/core/extensions";
import { loadEnv, type Env } from "@aeyhey/core";
import { createLogger } from "@aeyhey/core";
import plugins from "./aeyhey.plugins";

const log = createLogger("runtime");

export interface Runtime {
  env: Env;
  handle: DbHandle;
  registry: Registry;
  appSecret: string;
}

let runtime: Runtime | null = null;
let starting: Promise<Runtime> | null = null;

async function boot(options: { migrate: boolean }): Promise<Runtime> {
  const env = loadEnv();
  const handle = await getDb(env.DATABASE_URL);

  const { registry, appSecret } = await initExtensions({ handle, env, plugins });

  if (options.migrate) {
    // Idempotent and forward only, so running this on every web boot is safe and means
    // a self-hoster never has to remember a migrate step (PRD 16.1).
    await runMigrations({ handle, plugins: registry.pluginMigrations });
  }

  log.info("aeyhey is up", {
    edition: registry.config.edition,
    dialect: handle.dialect,
    demoMode: env.DEMO_MODE,
    publicUrl: env.PUBLIC_URL,
  });

  return { env, handle, registry, appSecret };
}

/** The web app and the worker both call this. Only the first caller does the work. */
export async function getRuntime(options: { migrate?: boolean } = {}): Promise<Runtime> {
  if (runtime) return runtime;
  if (!starting) {
    starting = boot({ migrate: options.migrate ?? false }).then((result) => {
      runtime = result;
      return result;
    });
  }
  return starting;
}

export async function shutdown(): Promise<void> {
  await closeDb();
  runtime = null;
  starting = null;
}
