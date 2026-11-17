// SPDX-License-Identifier: AGPL-3.0-only
// The HTTP boundary (PRD 11, 17).
//
// Every route handler is wrapped by `route()`, which does the four things that must happen
// identically everywhere: authenticate, check the origin on anything that changes state,
// validate the body with Zod, and turn a thrown error into a response with a message the
// user can act on.
//
// Doing this in one place is what stops a new endpoint quietly shipping without an
// origin check or with a stack trace in the body.

import { ZodError, type ZodType } from "zod";
import type { AuthProvider, AuthUser } from "../extensions/auth";
import { ForbiddenError, UnauthorizedError } from "../extensions/auth";
import { AIBlockedError } from "../extensions/usage";
import { NoAIProviderError } from "../extensions/ai-credentials";
import { AiContractError, AiProviderError } from "../ai/call";
import { BlockedUrlError } from "../security/ssrf";
import { createLogger } from "../logger";
import { apiTokenScopeFor } from "../extensions/api-tokens";

const log = createLogger("api");

export interface ApiError {
  error: {
    code: string;
    /** Written for the person reading it, not for a log. */
    message: string;
    /** Field errors from Zod, when the body was the problem. */
    fields?: Record<string, string[]>;
  };
}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}

export function fail(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
): Response {
  const body: ApiError = { error: { code, message, ...(fields ? { fields } : {}) } };
  return json(body, { status });
}

/**
 * Turns anything thrown inside a handler into a response. The default is deliberately
 * vague: an unexpected error's message may contain internals, so it is logged and the
 * client gets a generic line.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return fail(401, "unauthorized", error.message);
  }
  if (error instanceof ForbiddenError) {
    return fail(403, "forbidden", error.message);
  }
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    return fail(400, "invalid_request", "Some of that was not right.", fields);
  }
  if (error instanceof AIBlockedError) {
    // 402 rather than 500: nothing is broken, the user needs to do something.
    return fail(402, error.code, error.message);
  }
  if (error instanceof NoAIProviderError) {
    return fail(400, error.code, error.message);
  }
  if (error instanceof AiContractError || error instanceof AiProviderError) {
    return fail(502, error.code, error.message);
  }
  if (error instanceof BlockedUrlError) {
    return fail(400, "blocked_url", error.message);
  }

  // A typed error from a service, carrying its own status.
  const withStatus = error as { status?: number; message?: string; name?: string };
  if (typeof withStatus.status === "number" && withStatus.status < 500 && withStatus.message) {
    return fail(withStatus.status, withStatus.name ?? "error", withStatus.message);
  }

  log.error("an unhandled error reached the API boundary", {
    error: (error as Error).message,
    stack: (error as Error).stack,
  });
  return fail(500, "internal_error", "Something went wrong. Try again in a moment.");
}

/**
 * Origin check for state-changing requests (PRD 17).
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs from a form.
 * This is the second layer, and it is the one that catches a request from a page the
 * browser considers same-site but we do not.
 */
export function originAllowed(req: Request, publicUrl: string): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers.get("origin");
  // No Origin header at all means a non-browser client, such as curl or a script. Those
  // cannot be tricked by a third party page, so there is nothing for this check to stop.
  if (!origin) return true;

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicUrl).origin);
  } catch {
    // A malformed PUBLIC_URL should not lock everyone out.
  }
  try {
    allowed.add(new URL(req.url).origin);
  } catch {
    // Unreachable for a real request.
  }

  return allowed.has(origin);
}

export interface RouteContext<Body> {
  req: Request;
  user: AuthUser;
  body: Body;
  /** Query string parameters, already parsed. */
  query: URLSearchParams;
  /** Headers a handler may need to set, for example a session cookie. */
  headers: Headers;
}

export interface RouteOptions<Schema extends ZodType | undefined> {
  auth: AuthProvider;
  publicUrl: string;
  /** Validates the JSON body. Omit for a GET. */
  schema?: Schema;
  /** true for endpoints that must work without a session, such as first-run setup. */
  allowAnonymous?: boolean;
  /**
   * true for the few endpoints a coding agent's token may call (PRD 29.4 FR-AG-1).
   * Every other route refuses an agent token, so a leaked one cannot read anything.
   */
  allowAgentToken?: boolean;
}

type BodyOf<Schema> = Schema extends ZodType<infer Output> ? Output : undefined;

/**
 * Wraps a handler with auth, the origin check, body validation and error mapping.
 * A handler written through this cannot forget any of them.
 */
export function route<Schema extends ZodType | undefined = undefined>(
  options: RouteOptions<Schema>,
  handler: (ctx: RouteContext<BodyOf<Schema>>) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers();

    try {
      if (!originAllowed(req, options.publicUrl)) {
        return fail(403, "bad_origin", "That request did not come from this app.");
      }

      const user = options.allowAnonymous
        ? ((await options.auth.getUser(req)) ??
          ({ id: "", displayName: "", role: "owner" } as AuthUser))
        : await options.auth.requireUser(req);

      if (!options.allowAgentToken && apiTokenScopeFor(req) === "agent") {
        return fail(
          403,
          "agent_token",
          "This token can only report agent sessions and highlights. Sign in to do anything else.",
        );
      }

      let body: unknown;
      if (options.schema) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return fail(400, "invalid_json", "That request body was not valid JSON.");
        }
        body = options.schema.parse(raw);
      }

      const url = new URL(req.url);
      const response = await handler({
        req,
        user,
        body: body as BodyOf<Schema>,
        query: url.searchParams,
        headers,
      });

      // Anything the handler put on `headers`, such as a session cookie, is merged in.
      for (const [key, value] of headers) {
        response.headers.append(key, value);
      }
      return response;
    } catch (error) {
      const response = errorResponse(error);
      for (const [key, value] of headers) {
        response.headers.append(key, value);
      }
      return response;
    }
  };
}

/** Pagination and filter parsing, shared by the list endpoints. */
export function parseListQuery(query: URLSearchParams): {
  limit: number;
  cursor: string | undefined;
  q: string | undefined;
} {
  const rawLimit = Number(query.get("limit") ?? "50");
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50,
    cursor: query.get("cursor") ?? undefined,
    q: query.get("q")?.trim() || undefined,
  };
}
