// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/oauth/register: a coding agent registers itself to sign in (RFC 7591).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).oauthRegister(req);
}

export async function OPTIONS(): Promise<Response> {
  return (await api()).oauthPreflight();
}
