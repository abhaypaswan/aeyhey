// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { postgresConnection } from "../../src/db/client";

describe("postgresConnection", () => {
  it("keeps prepared statements on a direct connection", () => {
    const { url, options } = postgresConnection("postgres://u:p@db.example.com:5432/app", {});
    expect(url).toBe("postgres://u:p@db.example.com:5432/app");
    expect(options.prepare).toBe(true);
    expect(options.max).toBe(10);
  });

  it("turns prepared statements off behind a transaction pooler on port 6543", () => {
    const { options } = postgresConnection("postgresql://u:p@pooler.example.com:6543/app", {});
    expect(options.prepare).toBe(false);
  });

  it("reads pgbouncer=true and strips it so Postgres never sees it", () => {
    const { url, options } = postgresConnection(
      "postgres://u:p@db.example.com:5432/app?pgbouncer=true&sslmode=require",
      {},
    );
    expect(options.prepare).toBe(false);
    expect(url).toBe("postgres://u:p@db.example.com:5432/app?sslmode=require");
  });

  it("caps the pool from DATABASE_POOL_MAX, ignoring nonsense", () => {
    const at = (value: string) =>
      postgresConnection("postgres://db/app", { DATABASE_POOL_MAX: value }).options.max;
    expect(at("2")).toBe(2);
    expect(at("0")).toBe(10);
    expect(at("lots")).toBe(10);
  });
});
