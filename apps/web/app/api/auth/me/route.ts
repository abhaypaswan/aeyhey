// SPDX-License-Identifier: AGPL-3.0-only
import { api as coreApi, extensions, repos } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const { handle, registry } = await getRuntime();
  const user = await registry.auth.getUser(req);
  const hasOwner = await extensions.ownerExists(handle);

  // Whether the owner set an email at all. The login form uses this to stop asking for a
  // username that does not exist: on a single-user instance the email is optional, and an
  // empty box that looks required is the first thing a new self-hoster gets stuck on.
  const ownerHasEmail = hasOwner ? await extensions.ownerHasEmail(handle) : false;

  return coreApi.json({
    // With where their picture is, so the apps can show it from this one call.
    user: user ? { ...user, avatarUrl: await repos.ownAvatarUrl(handle, user.id) } : null,
    // needsSetup tells the client to show the first-run flow rather than a login form.
    needsSetup: !hasOwner,
    ownerHasEmail,
    authProvider: registry.auth.id,
    routes: registry.auth.routes ?? null,
  });
}
