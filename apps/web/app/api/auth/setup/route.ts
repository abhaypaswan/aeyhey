// SPDX-License-Identifier: AGPL-3.0-only
// First run only: create the owner (PRD 11, 12.1).
import { api as coreApi, extensions } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { handle, registry, env } = await getRuntime();

  // A multi-user instance has no owner to set up: people sign up through the auth
  // provider instead. Left open, this would let anyone create a local owner account.
  if (registry.config.flags.multiUser) {
    return coreApi.fail(404, "not_found", "There is no first-run setup here. Sign up instead.");
  }

  // There is exactly one owner. Once they exist this endpoint is closed, so it cannot be
  // used to add a second account to a single-user instance.
  if (await extensions.ownerExists(handle)) {
    return coreApi.fail(
      409,
      "already_setup",
      "This instance already has an owner. Sign in instead.",
    );
  }

  if (!coreApi.originAllowed(req, env.PUBLIC_URL)) {
    return coreApi.fail(403, "bad_origin", "That request did not come from this app.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return coreApi.fail(400, "invalid_json", "That request body was not valid JSON.");
  }

  const parsed = coreApi.SetupSchema.safeParse(body);
  if (!parsed.success) return coreApi.errorResponse(parsed.error);

  const user = await extensions.createOwner({
    handle,
    ...(parsed.data.email ? { email: parsed.data.email } : {}),
    password: parsed.data.password,
    ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
    ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
  });

  // Sign them straight in: asking someone to log in with the password they just chose is
  // a pointless extra step.
  const headers = new Headers();
  await registry.auth.signIn?.(
    { ...(parsed.data.email ? { email: parsed.data.email } : {}), password: parsed.data.password },
    { headers },
  );

  const response = coreApi.json({ user }, { status: 201 });
  for (const [key, value] of headers) response.headers.append(key, value);
  return response;
}
