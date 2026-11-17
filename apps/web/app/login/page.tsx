// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";
import { extensions } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { getRuntime } from "../../runtime";
import { LoginForm } from "../../components/login-form";
import { safeNextPath } from "../../lib/next-path";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Set by /connect, so a phone app's sign-in comes back to the Allow screen.
  const next = safeNextPath((await searchParams)["next"]);
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "ready") redirect(next ?? "/");

  // Rendered with the answer already in hand, so the form does not flicker between
  // asking for an email and not.
  const { handle } = await getRuntime();
  const ownerHasEmail = await extensions.ownerHasEmail(handle);

  return <LoginForm ownerHasEmail={ownerHasEmail} next={next} />;
}
