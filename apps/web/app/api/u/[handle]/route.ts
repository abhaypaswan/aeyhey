// SPDX-License-Identifier: AGPL-3.0-only
// The public page as JSON (PRD 28), for anyone. The web page at /u/:handle reads the same.
import { api } from "../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { handle } = await params;
  return (await api()).publicPage(handle)(req);
}
