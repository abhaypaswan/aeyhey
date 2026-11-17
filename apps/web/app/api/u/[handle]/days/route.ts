// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/u/:handle/days?before=YYYY-MM-DD: older days of the public feed, for anyone.
import { api } from "../../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { handle } = await params;
  return (await api()).publicDays(handle)(req);
}
