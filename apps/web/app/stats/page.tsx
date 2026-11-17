// SPDX-License-Identifier: AGPL-3.0-only
// Stats (PRD 12.1 screen 12).
//
// Everything here comes from the user's own tables. There is no telemetry in Aeyhey, and
// this page is why it needs none. The query lives in core, so this file only draws.

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { Bar, Card, CardTitle, EmptyState, Page, PageHeader, StatTile } from "../../components/ui";
import { pluralize, tagLabel } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const stats = await repos.loadStats(state.context.scope);

  const reviewPeak = Math.max(1, ...stats.reviewsPerDay.map((row) => row.count));
  const duePeak = Math.max(1, ...stats.duePerDay.map((row) => row.count));
  const totalTokens = stats.usage.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  const cleared = stats.links.read + stats.links.dropped + stats.links.expired;
  const remaining = stats.links.unread + stats.links.snoozed + stats.links.expiring;

  return (
    <Page>
      <PageHeader
        title="Stats"
        subtitle="How much you have reviewed, what is coming, and where you are weakest. All of it is counted on this machine and goes nowhere."
      />

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Reviews, 30 days" value={stats.totalReviews} />
        <StatTile label="Links cleared" value={cleared} detail="Read, dropped or expired" />
        <StatTile
          label="Average score"
          value={stats.averageScore === null ? "none yet" : stats.averageScore}
          detail="On answers you wrote"
        />
        <StatTile label="Links left" value={remaining} detail="Still waiting on you" />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {stats.totalReviews === 0 ? (
          <EmptyState
            title="Nothing to show yet"
            body="Do a session or two and this page will fill in."
          />
        ) : (
          <Card className="flex flex-col gap-4">
            <CardTitle hint={`Last 30 days. Busiest day: ${pluralize(reviewPeak, "review")}.`}>
              Reviews per day
            </CardTitle>
            <div
              className="flex h-44 items-end gap-1"
              role="img"
              aria-label={`Reviews per day over the last 30 days. Busiest day ${reviewPeak}.`}
            >
              {stats.reviewsPerDay.map((row) => (
                <div
                  key={row.day}
                  className="bg-primary min-h-px flex-1 rounded-t"
                  style={{ height: `${(row.count / reviewPeak) * 100}%` }}
                  title={`${row.day}: ${pluralize(row.count, "review")}`}
                />
              ))}
            </div>
          </Card>
        )}

        <Card className="flex flex-col gap-4">
          <CardTitle hint="A tall bar is a heavy day coming. Lowering your target retention spreads them out.">
            Due over the next 30 days
          </CardTitle>
          <div
            className="flex h-44 items-end gap-1"
            role="img"
            aria-label={`Cards due per day over the next 30 days. Heaviest day ${duePeak}.`}
          >
            {stats.duePerDay.map((row) => (
              <div
                key={row.day}
                className="bg-warning min-h-px flex-1 rounded-t"
                style={{ height: `${(row.count / duePeak) * 100}%` }}
                title={`${row.day}: ${pluralize(row.count, "card")}`}
              />
            ))}
          </div>
        </Card>

        {stats.scoreByTag.length > 0 ? (
          <Card className="flex flex-col gap-4">
            <CardTitle hint="Weakest first, which is the useful order.">Score by tag</CardTitle>
            <ul className="flex flex-col gap-2.5">
              {stats.scoreByTag.slice(0, 12).map((row) => (
                <li key={row.tag} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-sm">{tagLabel(row.tag)}</span>
                  <div className="flex-1">
                    <Bar
                      label={`Average score for ${tagLabel(row.tag)}`}
                      value={row.averageScore}
                      tone={row.averageScore >= 65 ? "success" : "warning"}
                    />
                  </div>
                  <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
                    {row.averageScore} of 100
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="flex flex-col gap-4">
          <CardTitle
            hint={
              stats.usage.length === 0
                ? undefined
                : `${totalTokens.toLocaleString()} tokens in total. Counted on your machine, and it goes nowhere.`
            }
          >
            AI usage
          </CardTitle>
          {stats.usage.length === 0 ? (
            <p className="text-muted-foreground text-sm">No AI calls yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="pb-1.5 font-medium">Task</th>
                  <th className="pb-1.5 text-right font-medium">Calls</th>
                  <th className="pb-1.5 text-right font-medium">Tokens in</th>
                  <th className="pb-1.5 text-right font-medium">Tokens out</th>
                </tr>
              </thead>
              <tbody>
                {stats.usage.map((row) => (
                  <tr key={row.task} className="border-border border-t">
                    <td className="py-2">{row.task}</td>
                    <td className="py-2 text-right tabular-nums">{row.calls}</td>
                    <td className="py-2 text-right tabular-nums">
                      {row.inputTokens.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {row.outputTokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Page>
  );
}
