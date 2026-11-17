// SPDX-License-Identifier: AGPL-3.0-only
// GET /api/profile/avatar: your own picture.
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).ownAvatar(req);
}
