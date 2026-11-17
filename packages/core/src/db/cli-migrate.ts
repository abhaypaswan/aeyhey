// SPDX-License-Identifier: AGPL-3.0-only
// pnpm db:migrate
import { closeDb, getDb } from "./client";
import { runMigrations } from "./migrate";
import { loadEnv } from "../env";

const env = loadEnv();
const handle = await getDb(env.DATABASE_URL);
await runMigrations({ handle });
await closeDb();
console.log("[aeyhey] migrations are up to date.");
