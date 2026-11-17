// SPDX-License-Identifier: AGPL-3.0-only
import { api as coreApi } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { registry, env } = await getRuntime();

  if (!coreApi.originAllowed(req, env.PUBLIC_URL)) {
    return coreApi.fail(403, "bad_origin", "That request did not come from this app.");
  }

  const headers = new Headers();
  await registry.auth.signOut(req, { headers });

  const response = coreApi.json({ ok: true });
  for (const [key, value] of headers) response.headers.append(key, value);
  return response;
}
