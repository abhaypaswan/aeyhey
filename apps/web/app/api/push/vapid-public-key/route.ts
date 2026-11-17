// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../../_api";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return (await api()).vapidPublicKey(req);
}
