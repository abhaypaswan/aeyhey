// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/agent/highlights: pin a line in today's journal (PRD 29).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).pinHighlight(req);
}
