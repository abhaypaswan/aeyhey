// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/highlights: the daily journal (PRD 29).
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).listHighlights(req);
}
