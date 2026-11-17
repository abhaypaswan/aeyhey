// SPDX-License-Identifier: AGPL-3.0-only
// AuthProvider (PRD 23.2).
//
// Every API handler and server component gets the current user through this interface
// and scopes every query by user.id. Community registers LocalSingleUserAuth. The hosted
// edition registers its own provider and nothing in feature code changes.

export type UserRole = "owner" | "member" | "admin";

export interface AuthUser {
  /** users.id */
  id: string;
  email?: string;
  displayName: string;
  role: UserRole;
}

/** What a provider writes cookies and headers onto. */
export type AuthResponseInit = ResponseInit & { headers: Headers };

export interface AuthRoutes {
  signIn: string;
  signUp?: string;
  account?: string;
  /** Where an out-of-credits message should send the user. Hosted only. */
  billing?: string;
}

export interface AuthProvider {
  /** "local-single-user", "hosted". */
  id: string;
  /** Reads the session from a cookie or header. Returns null when there is none. */
  getUser(req: Request): Promise<AuthUser | null>;
  /** Same, but throws UnauthorizedError when there is no session. */
  requireUser(req: Request): Promise<AuthUser>;
  signIn?(
    input: {
      email?: string;
      password: string;
      /** For per-client rate limiting. Best effort: it comes from proxy headers. */
      clientIp?: string;
    },
    res: AuthResponseInit,
  ): Promise<AuthUser>;
  signOut(req: Request, res: AuthResponseInit): Promise<void>;
  /**
   * Removes the account itself: the user row, its sign-in and anything the provider
   * keeps of its own. Called by DELETE /account after the user's data is already gone.
   * Hosted only. Without it, DELETE /account deletes the data and keeps the account,
   * which is right for a single-user server whose owner cannot be removed.
   */
  deleteAccount?(userId: string): Promise<void>;
  /** Hosted only. Community edition has no sign-up screen. */
  signUp?(input: { email: string; password?: string; name?: string }): Promise<AuthUser>;
  routes?: AuthRoutes;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "You need to sign in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You cannot do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
