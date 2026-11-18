// SPDX-License-Identifier: AGPL-3.0-only
// Where a coding agent registers, signs the person in and trades its code (RFC 8414).
import { api } from "../../api/_api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return (await api()).oauthAuthorizationServer();
}

export async function OPTIONS(): Promise<Response> {
  return (await api()).oauthPreflight();
}
