// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/health (PRD 11 Ops).
//
// The Docker healthcheck and both compose files depend on this, so it never needs auth and
// never throws. The actual check lives in core, so this route stays a wrapper.

import { db } from "@aeyhey/core";
import { getRuntime } from "../../../runtime";

export const dynamic = "force-dynamic";

const VERSION = process.env.AEYHEY_VERSION ?? "0.1.0";

export async function GET(): Promise<Response> {
  let handle = null;
  try {
    handle = (await getRuntime()).handle;
  } catch {
    // Startup failed, which the report below says plainly. An unauthenticated endpoint
    // should not hand out a stack trace.
  }

  const report = await db.checkHealth(handle, VERSION);

  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
