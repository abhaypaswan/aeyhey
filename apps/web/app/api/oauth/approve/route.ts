// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/oauth/approve: the Allow button on /oauth/authorize, with the website session.
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).oauthApprove(req);
}
