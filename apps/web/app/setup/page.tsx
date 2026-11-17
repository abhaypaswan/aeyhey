// SPDX-License-Identifier: AGPL-3.0-only
// First run (PRD 12.1 screen 1).

import { redirect } from "next/navigation";
import { pageState } from "../../lib/server";
import { SetupForm } from "../../components/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await pageState();
  // Once there is an owner this screen is pointless, and the endpoint behind it is closed.
  if (state.state !== "needs_setup") redirect("/");
  return <SetupForm />;
}
