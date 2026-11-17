// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/export (PRD 8.4 FR-SET-4).
import { api as coreApi, repos } from "@aeyhey/core";
import { getRuntime } from "../../../runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const { handle, registry } = await getRuntime();

  try {
    const user = await registry.auth.requireUser(req);
    const bundle = await coreApi.exportEverything(repos.scopeFor(handle, user.id));
    const stamp = new Date().toISOString().slice(0, 10);

    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="aeyhey-export-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return coreApi.errorResponse(error);
  }
}
