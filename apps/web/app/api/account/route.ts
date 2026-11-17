// SPDX-License-Identifier: AGPL-3.0-only
// DELETE /api/account: delete the account from inside an app (App Store guideline 5.1.1).
import { api } from "../_api";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  return (await api()).deleteAccount(req);
}
