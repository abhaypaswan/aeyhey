// SPDX-License-Identifier: AGPL-3.0-only
// The data half of the app shell.
//
// The sidebar shows where you stand (cards ready, links waiting, decks) on every screen,
// so those few counts are read here, once, on the server, and handed to the client frame
// that draws them. Before there is an owner or a signed-in user there is nothing to
// count, and the setup and login screens render on their own.

import type { ReactNode } from "react";
import { repos, scheduler } from "@aeyhey/core";
import { pageState, pluginNav } from "../lib/server";
import { ShellFrame } from "./nav";

export async function AppShell({ children }: { children: ReactNode }) {
  const state = await pageState();
  if (state.state !== "ready") return <>{children}</>;

  const { scope, user } = state.context;
  const settings = await repos.loadSettings(scope);
  const cadence = repos.toCadenceSettings(settings);
  const now = new Date();
  const window = scheduler.eligibilityWindow(now, cadence);

  const [due, links, decks] = await Promise.all([
    repos.dueCounts(scope, window.until),
    repos.linkCounts(scope),
    repos.listDecks(scope, now),
  ]);

  const paused = scheduler.isPaused(now, cadence);
  const cadenceLabel = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[settings.cadence];

  return (
    <ShellFrame
      data={{
        due: Math.min(settings.cardsPerSession, due.questionsDue + due.linksDue),
        waiting: links.unread + links.snoozed + links.expiring,
        decks: decks.filter((deck) => deck.kind !== "links").length,
        nextSession: paused ? null : scheduler.describeNextSession(now, cadence),
        rhythm: `${cadenceLabel}, ${settings.cardsPerSession} cards a session`,
        name: user.displayName === "You" ? null : user.displayName,
        avatarUrl: await repos.ownAvatarUrl(scope.handle, user.id),
        extraNav: await pluginNav(),
      }}
    >
      {children}
    </ShellFrame>
  );
}
