// SPDX-License-Identifier: AGPL-3.0-only
import { api } from "../../_api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return (await api()).updateQuestion(id)(req);
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return (await api()).deleteQuestion(id)(req);
}
