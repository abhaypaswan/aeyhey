// SPDX-License-Identifier: AGPL-3.0-only
// Signing a coding agent in through the browser, the way MCP servers such as Vercel's or
// Supabase's do it: the person adds the server's address to their agent, the agent opens
// the browser, they tap Allow, and the agent gets a token without anyone copying one.
//
// This is the MCP authorization spec (OAuth 2.1), the parts agents use today:
//   - /.well-known/oauth-protected-resource: which server signs agents in (RFC 9728),
//     pointed at by the 401 the MCP server answers with when there is no token.
//   - /.well-known/oauth-authorization-server: where to register, sign in and trade a
//     code (RFC 8414).
//   - POST /api/oauth/register: an agent registers itself (RFC 7591). No table: the
//     client id is the registration itself, signed with the app secret, so it cannot be
//     forged and needs nothing stored.
//   - /oauth/authorize (a page): the person signs in, sees which agent is asking and
//     where it will send them back, and taps Allow, which calls POST /api/oauth/approve.
//   - POST /api/oauth/token: the agent trades the one-time code and its PKCE verifier
//     for an agent token, which can only add notes and links (the same token as one
//     made in Settings, Agents), and shows under Signed-in apps to sign out.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DbHandle } from "../db/client";
import type { AuthProvider } from "../extensions/auth";
import {
  createAuthCode,
  exchangeAuthCode,
  InvalidGrantError,
  readBearer,
} from "../extensions/api-tokens";
import { fail, json, route } from "./respond";

/** The one scope an agent can ask for: add notes and links, read nothing. */
export const AGENT_SCOPE = "agent";

/** Where the MCP server lives under an instance's public URL. */
export function mcpResourceUrl(publicUrl: string): string {
  return `${trimBase(publicUrl)}/api/v1/mcp`;
}

function trimBase(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

// ---------------------------------------------------------------- client ids

export interface OauthClient {
  name: string;
  redirectUris: string[];
}

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", `oauth-client:${secret}`).update(payload).digest("base64url");
}

/** A client id that is its own registration: name and redirect URIs, signed. */
export function issueClientId(client: OauthClient, secret: string): string {
  const payload = base64url(JSON.stringify({ n: client.name, r: client.redirectUris }));
  return `${payload}.${sign(payload, secret)}`;
}

/** The registration a client id carries, or null if it was not made here. */
export function readClientId(clientId: string, secret: string): OauthClient | null {
  const [payload, signature, extra] = clientId.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      n?: unknown;
      r?: unknown;
    };
    if (typeof parsed.n !== "string" || !Array.isArray(parsed.r)) return null;
    const redirectUris = parsed.r.filter((uri): uri is string => typeof uri === "string");
    return { name: parsed.n, redirectUris };
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where an agent may ask to be sent back to: a port on this computer (how command line
 * agents listen), an https address, or an app's own scheme such as cursor://. Never
 * plain http elsewhere, and never javascript:, data: or file:.
 */
export function redirectUriAcceptable(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "http") return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (scheme === "https") return true;
  if (
    ["javascript", "data", "file", "blob", "about", "vbscript", "ftp", "ws", "wss"].includes(scheme)
  ) {
    return false;
  }
  // An app's own scheme: letters, digits, dots, plus and minus, starting with a letter.
  return /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

/** For the Allow page: where the person will be sent once they tap it, in plain words. */
export function describeRedirect(uri: string): { where: string; local: boolean } {
  try {
    const url = new URL(uri);
    const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    if (local) return { where: `this computer (port ${url.port || "80"})`, local: true };
    if (url.protocol === "https:") return { where: url.host, local: false };
    return { where: `the ${url.protocol.slice(0, -1)} app`, local: false };
  } catch {
    return { where: uri, local: false };
  }
}

// ---------------------------------------------------------------- the authorize request

export interface AuthorizeRequest {
  client: OauthClient;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

const PKCE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Checks what an agent sent to /oauth/authorize. A problem with the client or its
 * redirect URI is shown on the page and never redirected, as OAuth requires, since the
 * redirect is the part that cannot be trusted.
 */
export function readAuthorizeRequest(
  params: URLSearchParams,
  secret: string,
): { ok: true; request: AuthorizeRequest } | { ok: false; problem: string } {
  const clientId = params.get("client_id") ?? "";
  const client = readClientId(clientId, secret);
  if (!client) {
    return {
      ok: false,
      problem:
        "This agent is not registered with this Aeyhey. Remove the server from the agent and add it again.",
    };
  }
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, problem: "This agent asked to be sent somewhere it did not register." };
  }
  if (params.get("response_type") !== "code") {
    return {
      ok: false,
      problem: "This agent asked for a kind of sign-in this server does not do.",
    };
  }
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !PKCE.test(codeChallenge)) {
    return {
      ok: false,
      problem:
        "This agent sent a sign-in request without the protection this server needs. Update the agent and try again.",
    };
  }
  const state = params.get("state");
  return {
    ok: true,
    request: { client, clientId, redirectUri, codeChallenge, ...(state ? { state } : {}) },
  };
}

// ---------------------------------------------------------------- the endpoints

/** Discovery and token endpoints are called from agents and browser tools on any origin. */
const OPEN = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

function open(body: unknown, init: ResponseInit = {}): Response {
  const response = json(body, init);
  for (const [key, value] of Object.entries(OPEN)) response.headers.set(key, value);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** OAuth's own error shape, which agents read, rather than this API's. */
function oauthError(status: number, error: string, description: string): Response {
  return open({ error, error_description: description }, { status });
}

/** Form-encoded, as OAuth specifies, or JSON, which some clients send. */
async function readParams(req: Request): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string") params.set(key, value);
      }
      return params;
    }
    return new URLSearchParams(await req.text());
  } catch {
    return null;
  }
}

const RegisterSchema = z.object({
  redirect_uris: z.array(z.string().min(1).max(2000)).min(1).max(10),
  client_name: z.string().trim().max(80).optional(),
});

const ApproveSchema = z.strictObject({
  clientId: z.string().min(1).max(4000),
  redirectUri: z.string().min(1).max(2000),
  codeChallenge: z.string().min(43).max(128),
  state: z.string().max(1000).optional(),
});

export function createOauthApi(deps: {
  handle: DbHandle;
  base: { auth: AuthProvider; publicUrl: string };
  appSecret: string;
}) {
  const { handle, base, appSecret } = deps;
  const issuer = trimBase(base.publicUrl);
  const resource = mcpResourceUrl(base.publicUrl);

  return {
    /** RFC 9728, at /.well-known/oauth-protected-resource and its path-suffixed form. */
    oauthProtectedResource: async (): Promise<Response> =>
      open({
        resource,
        authorization_servers: [issuer],
        scopes_supported: [AGENT_SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "Aeyhey",
        resource_documentation: `${issuer}/agents`,
      }),

    /** RFC 8414, at /.well-known/oauth-authorization-server. */
    oauthAuthorizationServer: async (): Promise<Response> =>
      open({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/api/oauth/token`,
        registration_endpoint: `${issuer}/api/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [AGENT_SCOPE],
        service_documentation: `${issuer}/agents`,
      }),

    oauthPreflight: async (): Promise<Response> =>
      new Response(null, { status: 204, headers: OPEN }),

    /** RFC 7591: an agent registers itself, and gets a client id that is its registration. */
    oauthRegister: async (req: Request): Promise<Response> => {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return oauthError(400, "invalid_client_metadata", "Send the registration as JSON.");
      }
      const parsed = RegisterSchema.safeParse(raw);
      if (!parsed.success) {
        return oauthError(400, "invalid_client_metadata", "Send at least one redirect_uris entry.");
      }
      const redirectUris = parsed.data.redirect_uris;
      const bad = redirectUris.find((uri) => !redirectUriAcceptable(uri));
      if (bad) {
        return oauthError(
          400,
          "invalid_redirect_uri",
          "Redirect URIs must be on this computer (http://localhost or 127.0.0.1), https, or an app's own scheme.",
        );
      }
      const name = parsed.data.client_name || "A coding agent";
      const clientId = issueClientId({ name, redirectUris }, appSecret);
      return open(
        {
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: name,
          redirect_uris: redirectUris,
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: AGENT_SCOPE,
        },
        { status: 201 },
      );
    },

    /**
     * The Allow button. Signed in with the website's session only: an app or agent token
     * cannot approve another agent. Everything the page showed is checked again here.
     */
    oauthApprove: route({ ...base, schema: ApproveSchema }, async (ctx) => {
      if (readBearer(ctx.req) !== null) {
        return fail(403, "forbidden", "Approve an agent from the website, not from another app.");
      }
      const client = readClientId(ctx.body.clientId, appSecret);
      if (!client || !client.redirectUris.includes(ctx.body.redirectUri)) {
        return fail(400, "invalid_client", "This agent is not registered with this Aeyhey.");
      }
      const code = await createAuthCode(handle, {
        userId: ctx.user.id,
        codeChallenge: ctx.body.codeChallenge,
        redirectUri: ctx.body.redirectUri,
        deviceName: client.name,
        scope: "agent",
      });
      const target = new URL(ctx.body.redirectUri);
      target.searchParams.set("code", code);
      if (ctx.body.state !== undefined) target.searchParams.set("state", ctx.body.state);
      target.searchParams.set("iss", issuer);
      return json({ redirectTo: target.toString() });
    }),

    /** The agent's half: code and PKCE verifier in, agent token out. */
    oauthToken: async (req: Request): Promise<Response> => {
      const params = await readParams(req);
      if (!params) return oauthError(400, "invalid_request", "That request could not be read.");
      if (params.get("grant_type") !== "authorization_code") {
        return oauthError(400, "unsupported_grant_type", "Only authorization_code is supported.");
      }
      const client = readClientId(params.get("client_id") ?? "", appSecret);
      if (!client) return oauthError(401, "invalid_client", "This agent is not registered here.");
      const redirectUri = params.get("redirect_uri") ?? "";
      if (!client.redirectUris.includes(redirectUri)) {
        return oauthError(400, "invalid_grant", "The redirect URI does not match.");
      }
      try {
        const issued = await exchangeAuthCode(handle, {
          code: params.get("code") ?? "",
          codeVerifier: params.get("code_verifier") ?? "",
          redirectUri,
        });
        // A phone's code is not an agent's: only codes from the agent Allow page count.
        if (issued.scope !== "agent") {
          return oauthError(400, "invalid_grant", "That code was not issued to an agent.");
        }
        return open({
          access_token: issued.token,
          token_type: "Bearer",
          expires_in: Math.max(0, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)),
          scope: AGENT_SCOPE,
        });
      } catch (error) {
        if (error instanceof InvalidGrantError) {
          return oauthError(
            400,
            "invalid_grant",
            "That code has expired, been used, or does not match.",
          );
        }
        throw error;
      }
    },
  };
}

/**
 * The 401 an MCP server answers with when there is no token, pointing the agent at how
 * to sign in (RFC 9728 section 5.1). Without it an agent cannot find the sign-in.
 */
export function withSignInHint(response: Response, publicUrl: string): Response {
  if (response.status !== 401) return response;
  const metadata = `${trimBase(publicUrl)}/.well-known/oauth-protected-resource/api/v1/mcp`;
  const headers = new Headers(response.headers);
  headers.set("www-authenticate", `Bearer resource_metadata="${metadata}", scope="${AGENT_SCOPE}"`);
  headers.set("access-control-expose-headers", "www-authenticate");
  return new Response(response.body, { status: 401, headers });
}
