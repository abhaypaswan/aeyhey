// SPDX-License-Identifier: AGPL-3.0-only
// Which server signs agents in to the MCP server (RFC 9728). Served at the root and at
// the MCP server's path (/.well-known/oauth-protected-resource/api/v1/mcp), since agents
// try both.
import { api } from "../../../api/_api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return (await api()).oauthProtectedResource();
}

export async function OPTIONS(): Promise<Response> {
  return (await api()).oauthPreflight();
}
