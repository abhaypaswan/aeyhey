// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/oauth/token: a coding agent trades its one-time code for an agent token.
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).oauthToken(req);
}

export async function OPTIONS(): Promise<Response> {
  return (await api()).oauthPreflight();
}
