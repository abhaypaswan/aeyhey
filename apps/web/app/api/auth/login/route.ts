// SPDX-License-Identifier: AGPL-3.0-only
import { api as coreApi } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

/** The first hop in X-Forwarded-For, as set by the reverse proxy in front of the app. */
function clientIp(req: Request): { clientIp?: string } {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim();
  return ip ? { clientIp: ip } : {};
}

export async function POST(req: Request): Promise<Response> {
  const { registry, env } = await getRuntime();

  if (!coreApi.originAllowed(req, env.PUBLIC_URL)) {
    return coreApi.fail(403, "bad_origin", "That request did not come from this app.");
  }
  if (!registry.auth.signIn) {
    return coreApi.fail(400, "no_password_auth", "This instance does not use a password.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return coreApi.fail(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = coreApi.LoginSchema.safeParse(body);
  if (!parsed.success) return coreApi.errorResponse(parsed.error);

  const headers = new Headers();
  try {
    const user = await registry.auth.signIn({ ...parsed.data, ...clientIp(req) }, { headers });
    const response = coreApi.json({ user });
    for (const [key, value] of headers) response.headers.append(key, value);
    return response;
  } catch (error) {
    return coreApi.errorResponse(error);
  }
}
