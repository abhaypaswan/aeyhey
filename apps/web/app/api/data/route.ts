// SPDX-License-Identifier: AGPL-3.0-only
// DELETE /api/data: remove everything (PRD 8.4 FR-SET-4, 17).
import { api as coreApi, repos } from "@aeyhey/core";
import { getRuntime } from "../../../runtime";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  const { handle, registry, env } = await getRuntime();

  if (!coreApi.originAllowed(req, env.PUBLIC_URL)) {
    return coreApi.fail(403, "bad_origin", "That request did not come from this app.");
  }

  try {
    const user = await registry.auth.requireUser(req);

    // A typed confirmation in the body, so a stray DELETE cannot wipe an account.
    let body: { confirm?: string } = {};
    try {
      body = (await req.json()) as { confirm?: string };
    } catch {
      // No body at all, which fails the check below.
    }
    if (body.confirm !== "delete everything") {
      return coreApi.fail(
        400,
        "not_confirmed",
        'Send { "confirm": "delete everything" } to go ahead. This cannot be undone.',
      );
    }

    const result = await coreApi.deleteAllData(repos.scopeFor(handle, user.id), {
      dataDir: env.DATA_DIR,
    });
    return coreApi.json(result);
  } catch (error) {
    return coreApi.errorResponse(error);
  }
}
