// SPDX-License-Identifier: AGPL-3.0-only
// LocalSingleUserAuth: the community default (PRD 23.2, 15, 17).
//
// One owner, an argon2id password hash, and a signed HTTP-only session cookie. There is
// no sign-up: the first run creates the owner and that is the only account.
//
// AUTH_MODE=none skips the password entirely and signs everyone in as the owner. That is
// for a trusted LAN, env.ts logs a warning about it, and it is the only way this provider
// ever hands out a session without a password.

import { hash, verify } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import type { AuthProvider, AuthUser } from "../auth";
import { UnauthorizedError } from "../auth";
import type { DbHandle } from "../../db/client";
import { signToken, THIRTY_DAYS_MS, verifyToken } from "../../security/tokens";
import { newId } from "../../ids";
import { createLogger } from "../../logger";

const log = createLogger("auth");

export const SESSION_COOKIE = "aeyhey_session";

/** argon2id, tuned for an interactive login on modest self-host hardware. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

interface SessionPayload extends Record<string, unknown> {
  userId: string;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookieAttributes(secure: boolean, maxAgeSeconds: number): string {
  const bits = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export interface LocalAuthOptions {
  handle: DbHandle;
  appSecret: string;
  /** "password" or "none". */
  authMode: "password" | "none";
  /** Secure cookie when PUBLIC_URL is https. */
  publicUrl: string;
}

/**
 * A sliding one-minute limiter for login (PRD 17). Used twice: per client, 5 tries a
 * minute, and across everyone, 30 a minute. The client key comes from proxy headers and
 * can be faked, so the shared ceiling is what actually bounds a password guesser.
 */
class LoginLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly perMinute: number) {}

  check(key: string, now = Date.now()): boolean {
    const windowStart = now - 60_000;
    if (this.hits.size > 10_000) {
      // Forget clients that have gone quiet, so a flood of fake addresses cannot grow
      // this map without end.
      for (const [client, times] of this.hits) {
        if (!times.some((t) => t > windowStart)) this.hits.delete(client);
      }
    }
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export class TooManyAttemptsError extends Error {
  readonly status = 429;
  constructor() {
    super("Too many sign-in attempts. Wait a minute and try again.");
    this.name = "TooManyAttemptsError";
  }
}

export function createLocalSingleUserAuth(options: LocalAuthOptions): AuthProvider {
  const { handle, appSecret, authMode } = options;
  const { users } = handle.schema;
  const secure = options.publicUrl.startsWith("https://");
  const perClient = new LoginLimiter(5);
  const everyone = new LoginLimiter(30);

  async function loadOwner(): Promise<AuthUser | null> {
    const rows = await handle.db.select().from(users).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      ...(row.email ? { email: row.email } : {}),
      displayName: row.displayName,
      role: "owner",
    };
  }

  async function loadById(id: string): Promise<AuthUser | null> {
    const rows = await handle.db.select().from(users).where(eq(users.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      ...(row.email ? { email: row.email } : {}),
      displayName: row.displayName,
      role: (row.role ?? "owner") as AuthUser["role"],
    };
  }

  return {
    id: "local-single-user",
    routes: { signIn: "/login", account: "/settings/account" },

    async getUser(req) {
      // AUTH_MODE=none: whoever can reach the app is the owner. Documented, and warned about.
      if (authMode === "none") return loadOwner();

      const raw = readCookie(req, SESSION_COOKIE);
      if (!raw) return null;

      const result = verifyToken<SessionPayload>({
        purpose: "session",
        token: raw,
        appSecret,
      });
      if (!result.ok) {
        log.debug("rejected a session cookie", { reason: result.reason });
        return null;
      }
      return loadById(result.payload.userId);
    },

    async requireUser(req) {
      const user = await this.getUser(req);
      if (!user) throw new UnauthorizedError();
      return user;
    },

    async signIn(input, res) {
      // Before, every attempt shared one key, so five wrong passwords from anyone locked
      // out everyone for a minute.
      if (!perClient.check(input.clientIp ?? "unknown") || !everyone.check("all")) {
        throw new TooManyAttemptsError();
      }

      const rows = input.email
        ? await handle.db.select().from(users).where(eq(users.email, input.email)).limit(1)
        : await handle.db.select().from(users).limit(1);
      const row = rows[0];

      // Hash anyway when there is no such user, so a missing account and a wrong
      // password take about the same time.
      if (!row?.passwordHash) {
        await hashPassword(input.password);
        throw new UnauthorizedError("That email or password is not right.");
      }
      if (!(await verifyPassword(row.passwordHash, input.password))) {
        throw new UnauthorizedError("That email or password is not right.");
      }

      const { token } = signToken<SessionPayload>({
        purpose: "session",
        payload: { userId: row.id },
        appSecret,
        ttlMs: THIRTY_DAYS_MS,
      });
      res.headers.append(
        "set-cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(secure, THIRTY_DAYS_MS / 1000)}`,
      );

      log.info("signed in", { userId: row.id });
      return {
        id: row.id,
        ...(row.email ? { email: row.email } : {}),
        displayName: row.displayName,
        role: "owner",
      };
    },

    async signOut(_req, res) {
      res.headers.append("set-cookie", `${SESSION_COOKIE}=; ${cookieAttributes(secure, 0)}`);
    },
  };
}

/** First run only. Creates the owner, their settings row and the built-in Links deck. */
export async function createOwner(input: {
  handle: DbHandle;
  email?: string | undefined;
  password?: string | undefined;
  displayName?: string | undefined;
  timezone?: string | undefined;
}): Promise<AuthUser> {
  const { handle } = input;
  const { users, settings, decks } = handle.schema;

  const existing = await handle.db.select().from(users).limit(1);
  if (existing.length > 0) {
    throw new Error("This instance already has an owner.");
  }

  const id = newId();
  await handle.db.insert(users).values({
    id,
    email: input.email ?? null,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    displayName: input.displayName ?? "You",
    timezone: input.timezone ?? "UTC",
    role: "owner",
    createdAt: new Date(),
  });

  await handle.db.insert(settings).values({ userId: id, updatedAt: new Date() });

  // Links do not belong to a generated deck, so every user gets this one built-in.
  await handle.db.insert(decks).values({
    id: newId(),
    userId: id,
    name: "Links",
    kind: "links",
    createdAt: new Date(),
  });

  log.info("created the owner account", { userId: id });
  return {
    id,
    ...(input.email ? { email: input.email } : {}),
    displayName: input.displayName ?? "You",
    role: "owner",
  };
}

export async function ownerExists(handle: DbHandle): Promise<boolean> {
  const rows = await handle.db.select().from(handle.schema.users).limit(1);
  return rows.length > 0;
}

/**
 * Whether the owner set an email address. The email is optional on a single-user
 * instance, and the login screen uses this to decide whether to ask for one at all.
 */
export async function ownerHasEmail(handle: DbHandle): Promise<boolean> {
  const rows = await handle.db.select().from(handle.schema.users).limit(1);
  const email = rows[0]?.email;
  return typeof email === "string" && email.trim() !== "";
}

export async function findLinksDeckId(handle: DbHandle, userId: string): Promise<string | null> {
  const { decks } = handle.schema;
  const rows = await handle.db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, userId), eq(decks.kind, "links")))
    .limit(1);
  return rows[0]?.id ?? null;
}
