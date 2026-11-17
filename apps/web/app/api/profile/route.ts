// SPDX-License-Identifier: AGPL-3.0-only
// GET and PATCH /api/profile: your name and picture.
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).getProfile(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return (await api()).updateProfile(req);
}
