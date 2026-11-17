// SPDX-License-Identifier: AGPL-3.0-only
// pnpm demo:seed, and pnpm demo:reset with --reset.
import { closeDb, getDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { loadEnv } from "../env";
import { resetDemoData, seedDemoData } from "./index";

const env = loadEnv();
const handle = await getDb(env.DATABASE_URL);
await runMigrations({ handle });

const reset = process.argv.includes("--reset");
const result = reset ? await resetDemoData(handle) : await seedDemoData(handle);

await closeDb();

if (result) {
  console.log(
    `[aeyhey] demo data ready: ${result.links} links, ${result.questions} questions across ${result.decks} decks, ${result.reviews} reviews.`,
  );
} else {
  console.log("[aeyhey] demo data was already there. Use --reset to rebuild it.");
}
