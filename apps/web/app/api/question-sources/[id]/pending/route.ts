// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return (await api()).getPendingReview(id)(req);
}
