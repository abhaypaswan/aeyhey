// SPDX-License-Identifier: AGPL-3.0-only
// An in-memory database for integration tests.
//
// Uses the real migration files, not a hand-written schema, so a test failing here means
// the migrations a self-hoster will run are actually broken.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";

export interface TestDb {
  handle: DbHandle;
  cleanup(): Promise<void>;
}

/**
 * A file-backed database in a temp directory rather than :memory:, because the WAL
 * pragmas and the migration runner both behave like they will in production this way.
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "aeyhey-test-"));
  const handle = await openDb(`file:${join(dir, "test.db")}`);
  await runMigrations({ handle });

  return {
    handle,
    async cleanup() {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
