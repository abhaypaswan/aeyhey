// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).getSettings(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return (await api()).updateSettings(req);
}
