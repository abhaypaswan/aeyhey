// SPDX-License-Identifier: AGPL-3.0-only
// PATCH /api/highlights/:id: keep, drop or reword a highlight (PRD 29).
import { api } from "../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return (await api()).updateHighlight(id)(req);
}
