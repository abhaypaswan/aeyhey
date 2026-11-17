// SPDX-License-Identifier: AGPL-3.0-only
// The session screen (PRD 12.1 screen 3).
//
// Built on the server so the first card is on screen without a loading state, then handed
// to the client component which owns every action from there.

import { redirect } from "next/navigation";
import { sessions } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { SessionView } from "../../components/session-view";

export const dynamic = "force-dynamic";

export default async function SessionPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const payload = await sessions.getOrBuildSession(state.context.scope, { trigger: "manual" });

  // The server payload has Date objects on the session row; the client only reads its id.
  return (
    <SessionView
      initial={{
        session: payload.session ? { id: payload.session.id } : null,
        items: payload.items as never,
        progress: payload.progress,
        nextSessionLabel: payload.nextSessionLabel,
        ...(payload.emptyReason ? { emptyReason: payload.emptyReason } : {}),
        counts: payload.counts,
      }}
    />
  );
}
