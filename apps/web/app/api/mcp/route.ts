// SPDX-License-Identifier: AGPL-3.0-only
// /api/mcp: the MCP server for coding agents (PRD 29.4 FR-AG-3).
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).mcp(req);
}

export async function GET(req: Request): Promise<Response> {
  return (await api()).mcpGet(req);
}
