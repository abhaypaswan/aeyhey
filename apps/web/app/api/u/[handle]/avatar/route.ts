// SPDX-License-Identifier: AGPL-3.0-only
// The picture on a public page (PRD 28), for anyone, only while the page is on. The web
// page links /u/:handle/avatar, which serves the same.
import { api } from "../../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { handle } = await params;
  return (await api()).publicAvatar(handle)(req);
}
