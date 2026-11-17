// SPDX-License-Identifier: AGPL-3.0-only
// The plugin API catch-all (PRD 23.5).
//
// Plugins cannot add Next.js route files at runtime, so every plugin route is dispatched
// here. In the community build the plugin list is empty, so this always 404s, which is
// correct and costs nothing. The hosted edition's payment webhook lives at
// /api/ext/billing/webhook through this.

import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

async function dispatch(req: Request, path: string[]): Promise<Response> {
  const { registry } = await getRuntime();
  const wanted = path.join("/");
  const method = req.method.toUpperCase();

  const match = registry.apiRoutes.find(
    (candidate) => candidate.path.replace(/^\/+/, "") === wanted && candidate.method === method,
  );

  if (!match) {
    return Response.json(
      { error: { code: "not_found", message: "There is no extension route there." } },
      { status: 404 },
    );
  }

  return match.handler(req);
}

type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  return dispatch(req, (await params).path);
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  return dispatch(req, (await params).path);
}

export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  return dispatch(req, (await params).path);
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  return dispatch(req, (await params).path);
}
