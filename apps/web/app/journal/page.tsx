// SPDX-License-Identifier: AGPL-3.0-only
// Journal (PRD 29): each day with what you read, reviewed and built with coding agents.

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { JournalView } from "../../components/journal-view";

export const dynamic = "force-dynamic";

const WEEKS = 52;

export default async function JournalPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope } = state.context;
  const today = await repos.todayFor(scope.handle, scope.userId);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (WEEKS * 7 - 1));
  const from = start.toISOString().slice(0, 10);

  // The day list covers 60 days; the activity grid and totals cover a year.
  const listFrom = new Date(`${today}T00:00:00Z`);
  listFrom.setUTCDate(listFrom.getUTCDate() - 59);
  const [days, highlights, building, journal] = await Promise.all([
    repos.listAgentDays(scope, from),
    repos.listHighlights(scope, { from }),
    repos.keptDays(scope, from),
    repos.loadJournal(scope, listFrom.toISOString().slice(0, 10)),
  ]);

  // The same one activity the public page shows, with building always counted here,
  // since this is the owner's own view.
  const stats = await repos.loadPublicStats(
    scope,
    new Date(),
    new Map(days.map((d) => [d.day, repos.buildWeight(d.activeMinutes)])),
  );

  return (
    <JournalView
      today={today}
      days={days}
      highlights={highlights}
      reading={journal
        .filter((d) => d.read.length > 0 || d.reviews > 0)
        .map((d) => ({ day: d.day, read: d.read, reviews: d.reviews }))}
      daysBuilding={building.length}
      activity={stats.activity}
    />
  );
}
