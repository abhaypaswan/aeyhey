// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/agent/stats: daily agent totals (PRD 29.3).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).agentStats(req);
}
