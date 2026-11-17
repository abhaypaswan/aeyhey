// SPDX-License-Identifier: AGPL-3.0-only
// One transaction API across both dialects.
//
// The two drivers disagree in a way that matters. postgres-js is asynchronous and
// drizzle's `db.transaction(async tx => ...)` is the natural form. better-sqlite3 is
// synchronous, and its transaction wrapper refuses a callback that returns a promise:
// "Transaction function cannot return a promise". So the same code cannot use
// db.transaction on both.
//
// This helper gives one shape. On Postgres it delegates to drizzle. On SQLite it issues
// BEGIN, COMMIT and ROLLBACK itself and runs the callback in between, which works because
// better-sqlite3 executes every statement synchronously on one connection.
//
// The one rule that comes with that: do not do genuinely asynchronous work inside the
// callback. Writes are fine, because they complete synchronously underneath. An AI call,
// an HTTP request or a timer would hold the transaction open across the event loop, and
// on SQLite that blocks every other writer. Fetch first, then write.

import type { DbHandle, Database } from "./client";

export type TransactionBody<T> = (tx: Database) => Promise<T>;

interface SyncExec {
  exec(sql: string): unknown;
}

export async function withTransaction<T>(handle: DbHandle, body: TransactionBody<T>): Promise<T> {
  if (handle.dialect === "postgres") {
    return (await (
      handle.db as unknown as {
        transaction<R>(fn: (tx: Database) => Promise<R>): Promise<R>;
      }
    ).transaction(body)) as T;
  }

  const raw = handle.raw as SyncExec;

  // A nested call would fail with "cannot start a transaction within a transaction", so
  // savepoints would be the fix if we ever needed nesting. We do not: every caller is a
  // single repository function.
  raw.exec("BEGIN");
  try {
    const result = await body(handle.db);
    raw.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      raw.exec("ROLLBACK");
    } catch {
      // Already rolled back, or the connection is gone. The original error is the one
      // worth reporting.
    }
    throw error;
  }
}
