// SPDX-License-Identifier: AGPL-3.0-only
// Sign-in for apps that are not a browser, such as the mobile app.
//
// A browser keeps a session cookie. A phone app wants a token it can store in the
// keychain and send as `Authorization: Bearer ...`. This file adds that on top of
// whichever AuthProvider is registered, so it works the same for the community password
// login and for the hosted edition's magic links and OAuth:
//
//   1. The app opens /connect in the system browser with a PKCE challenge.
//   2. The person signs in there the normal way, then taps Allow.
//   3. The site redirects to the app with a one-time code.
//   4. The app trades the code and its PKCE verifier for a long-lived token.
//
// The app never sees a password, and a code caught on the way back is useless without
// the verifier, which never left the phone.
//
// Only SHA-256 hashes of tokens and codes are stored.

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { Scope } from "../repos/context";
import { hashToken } from "../security/tokens";
import { constantTimeEqual } from "../security/crypto";
import { newId } from "../ids";
import { UnauthorizedError, type AuthProvider, type AuthUser } from "./auth";
import { createLogger } from "../logger";

const log = createLogger("api-tokens");

/** Makes a leaked token easy to spot in a log or a secret scanner. */
export const API_TOKEN_PREFIX = "ahy_";
export const API_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** last_used_at is written at most this often, so a busy app is not a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

/** The redirect an app gets when the operator has not set API_REDIRECT_URIS. */
export const DEFAULT_REDIRECT_URIS = ["aeyhey://auth"] as const;

export class InvalidGrantError extends Error {
  readonly status = 400;
  constructor(message = "That sign-in code is not valid any more. Start signing in again.") {
    super(message);
    this.name = "invalid_grant";
  }
}

export class InvalidRedirectError extends Error {
  readonly status = 400;
  constructor() {
    super("That app is not allowed to sign in here.");
    this.name = "invalid_redirect";
  }
}

function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** The S256 PKCE transform: base64url(sha256(verifier)), as in RFC 7636. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Reads `Authorization: Bearer <token>`. Returns null when there is no such header. */
export function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Whether an app may receive a code at this redirect. Compared exactly, never by prefix,
 * because "aeyhey://auth.evil" must not pass for "aeyhey://auth".
 */
export function redirectAllowed(redirectUri: string, allowed: readonly string[]): boolean {
  return allowed.includes(redirectUri);
}

export function parseRedirectList(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_REDIRECT_URIS];
}

// ---------------------------------------------------------------- tokens

export interface IssuedToken {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * app: everything the person can do. agent: only reporting coding agent sessions and
 * highlights (PRD 29.4 FR-AG-1). Routes refuse an agent token unless they opt in.
 */
export type ApiTokenScope = "app" | "agent";

export async function issueApiToken(
  handle: DbHandle,
  input: { userId: string; name: string; now?: Date; scope?: ApiTokenScope },
): Promise<IssuedToken> {
  const now = input.now ?? new Date();
  const token = `${API_TOKEN_PREFIX}${randomSecret()}`;
  const id = newId();
  const expiresAt = new Date(now.getTime() + API_TOKEN_TTL_MS);

  await handle.db.insert(handle.schema.apiTokens).values({
    id,
    userId: input.userId,
    name: input.name.slice(0, 80),
    tokenHash: hashToken(token),
    scope: input.scope ?? "app",
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  });

  log.info("issued an app token", { userId: input.userId, tokenId: id });
  return { id, token, expiresAt };
}

export interface ResolvedToken {
  id: string;
  userId: string;
  scope: ApiTokenScope;
}

/** Looks a raw token up. Returns null for unknown, revoked or expired tokens. */
export async function resolveApiToken(
  handle: DbHandle,
  token: string,
  now = new Date(),
): Promise<ResolvedToken | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const { apiTokens } = handle.schema;

  const rows = await handle.db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await handle.db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, row.id))
      .catch(() => {
        // A failed bookkeeping write must not fail the request it rode in on.
      });
  }

  return { id: row.id, userId: row.userId, scope: row.scope === "agent" ? "agent" : "app" };
}

export interface ApiTokenView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** True for the token the request itself was made with. */
  current: boolean;
  scope: ApiTokenScope;
}

/** The signed-in apps, for Settings. Never includes the token itself. */
export async function listApiTokens(
  scope: Scope,
  currentTokenId?: string,
): Promise<ApiTokenView[]> {
  const { apiTokens } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, scope.userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  const now = Date.now();
  return rows
    .filter((row) => !row.expiresAt || row.expiresAt.getTime() > now)
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      current: row.id === currentTokenId,
      scope: row.scope === "agent" ? ("agent" as const) : ("app" as const),
    }));
}

/**
 * Signs one app out. Its push registrations go with it, so a phone that was signed out
 * from Settings stops getting reminders. Returns false when there was no such token.
 */
export async function revokeApiToken(scope: Scope, tokenId: string): Promise<boolean> {
  const { apiTokens, devices } = scope.handle.schema;
  const updated = await scope.handle.db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, scope.userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });

  await scope.handle.db
    .delete(devices)
    .where(and(eq(devices.userId, scope.userId), eq(devices.apiTokenId, tokenId)));

  return updated.length > 0;
}

// ---------------------------------------------------------------- codes

export interface AuthCodeInput {
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  deviceName: string;
  now?: Date;
}

/** Called by /connect once the person taps Allow. Returns the raw one-time code. */
export async function createAuthCode(handle: DbHandle, input: AuthCodeInput): Promise<string> {
  const now = input.now ?? new Date();
  const code = randomSecret();

  await handle.db.insert(handle.schema.authCodes).values({
    codeHash: hashToken(code),
    userId: input.userId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    deviceName: input.deviceName.slice(0, 80),
    expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
    usedAt: null,
    createdAt: now,
  });

  return code;
}

export interface ExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  now?: Date;
}

/**
 * Trades a code for a token. The code is marked used in the same statement that reads
 * it, so two requests racing with one code cannot both win.
 */
export async function exchangeAuthCode(
  handle: DbHandle,
  input: ExchangeInput,
): Promise<IssuedToken & { userId: string; deviceName: string }> {
  const now = input.now ?? new Date();
  const { authCodes } = handle.schema;

  const claimed = await handle.db
    .update(authCodes)
    .set({ usedAt: now })
    .where(and(eq(authCodes.codeHash, hashToken(input.code)), isNull(authCodes.usedAt)))
    .returning();
  const row = claimed[0];

  if (!row) throw new InvalidGrantError();
  if (row.expiresAt.getTime() <= now.getTime()) throw new InvalidGrantError();
  if (row.redirectUri !== input.redirectUri) throw new InvalidGrantError();
  if (!constantTimeEqual(pkceChallenge(input.codeVerifier), row.codeChallenge)) {
    throw new InvalidGrantError();
  }

  const issued = await issueApiToken(handle, {
    userId: row.userId,
    name: row.deviceName,
    now,
  });
  return { ...issued, userId: row.userId, deviceName: row.deviceName };
}

// ---------------------------------------------------------------- the provider wrapper

/**
 * Which token a request was made with, for handlers that care, such as device
 * registration. Keyed on the Request object, so nothing leaks between requests.
 */
const tokenIdByRequest = new WeakMap<Request, string>();

export function apiTokenIdFor(req: Request): string | undefined {
  return tokenIdByRequest.get(req);
}

const tokenScopeByRequest = new WeakMap<Request, ApiTokenScope>();

/** The scope of the token a request was made with, or undefined for a browser session. */
export function apiTokenScopeFor(req: Request): ApiTokenScope | undefined {
  return tokenScopeByRequest.get(req);
}

async function loadUser(handle: DbHandle, userId: string): Promise<AuthUser | null> {
  const { users } = handle.schema;
  const rows = await handle.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ...(row.email ? { email: row.email } : {}),
    displayName: row.displayName,
    role: (row.role ?? "owner") as AuthUser["role"],
  };
}

/**
 * Puts bearer tokens in front of any AuthProvider. A request with an Authorization
 * header is judged on that header alone: a bad token is a 401, never a quiet fall back
 * to a cookie that happens to be there. A request without one goes to the provider
 * unchanged, so the browser app does not notice this exists.
 */
export function withApiTokens(provider: AuthProvider, options: { handle: DbHandle }): AuthProvider {
  const { handle } = options;

  return {
    ...provider,

    async getUser(req) {
      const bearer = readBearer(req);
      if (bearer === null) return provider.getUser(req);

      const resolved = await resolveApiToken(handle, bearer);
      if (!resolved) return null;
      tokenIdByRequest.set(req, resolved.id);
      tokenScopeByRequest.set(req, resolved.scope);
      return loadUser(handle, resolved.userId);
    },

    async requireUser(req) {
      if (readBearer(req) === null) return provider.requireUser(req);
      const user = await this.getUser(req);
      if (!user) throw new UnauthorizedError("That app is signed out. Sign in again.");
      return user;
    },

    async signOut(req, res) {
      const bearer = readBearer(req);
      if (bearer === null) return provider.signOut(req, res);

      const resolved = await resolveApiToken(handle, bearer);
      if (resolved) {
        await revokeApiToken({ handle, userId: resolved.userId }, resolved.id);
      }
    },
  };
}
