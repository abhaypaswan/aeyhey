// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/agent/sessions: a coding agent's hook reports one finished session (PRD 29).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).reportAgentSession(req);
}
