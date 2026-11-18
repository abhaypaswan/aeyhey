// SPDX-License-Identifier: AGPL-3.0-only
// POST /api/assistant: one message to the assistant. See packages/core/src/assistant.
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return (await api()).assistant(req);
}
