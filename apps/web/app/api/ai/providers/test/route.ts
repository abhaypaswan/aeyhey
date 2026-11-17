// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../../../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).testProvider(req);
}
