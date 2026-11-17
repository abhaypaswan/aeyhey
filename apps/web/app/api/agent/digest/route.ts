// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/agent/digest: draft a day's highlights now (PRD 29.2).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).draftHighlights(req);
}
