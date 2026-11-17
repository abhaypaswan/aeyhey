// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/agent/tokens: a token for a coding agent's config (PRD 29.4 FR-AG-1).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).createAgentToken(req);
}
