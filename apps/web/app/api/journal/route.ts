// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/journal: each day with what you read, reviewed and built (PRD 29).
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).journal(req);
}
