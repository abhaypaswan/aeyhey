// SPDX-License-Identifier: AGPL-3.0-only
// Stats, as the phone app has them.
//
// It opens with one big number and a sentence rather than a wall of tiles, and every
// figure below it is drawn: a ring for the score, the flame, a dot for each day. No
// boxes, only headings and hairlines. A wide screen puts what you did on the left and
// what you hold (decks, topics, links) on the right.
//
// Everything here comes from the user's own tables. There is no telemetry in Aeyhey, and
// this page is why it needs none.

import { redirect } from "next/navigation";
import { repos, sessions } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import {
  ActiveDots,
  DeckStack,
  ScoreRing,
  SplitBar,
  StatsBars,
  StreakFlame,
} from "../../components/drawings";
import { pluralize } from "../../lib/format";
import { cx } from "../../components/ui";

export const dynamic = "force-dynamic";

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const BANDS = [
  { name: "Needs work", max: 50, color: "var(--color-danger)" },
  { name: "Getting there", max: 75, color: "var(--color-warning)" },
  { name: "Strong", max: 101, color: "var(--color-success)" },
];

export default async function StatsPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope } = state.context;
  const [stats, today, decks] = await Promise.all([
    repos.loadStats(scope),
    sessions.loadToday(scope),
    repos.listDecks(scope),
  ]);

  const answered = stats.reviewsPerDay.reduce((sum, row) => sum + row.count, 0);
  const active = stats.reviewsPerDay.filter((row) => row.count > 0).length;
  const days = stats.reviewsPerDay.length;
  const coming = stats.duePerDay.slice(0, 14);
  const dueToday = coming[0]?.count ?? 0;
  const dueWeek = coming.slice(1, 7).reduce((sum, row) => sum + row.count, 0);
  const questionDecks = decks
    .filter((deck) => deck.kind !== "links" && deck.counts.total > 0)
    .sort((a, b) => b.counts.total - a.counts.total);
  const tags = [...stats.scoreByTag].sort((a, b) => a.averageScore - b.averageScore);
  const links = stats.links;
  const linkParts = [
    { label: "Read", value: links.read, color: "var(--color-success)" },
    { label: "Unread", value: links.unread + links.expiring, color: "var(--color-primary)" },
    {
      label: "For later",
      value: links.snoozed,
      color: "color-mix(in srgb, var(--color-primary) 45%, transparent)",
    },
    { label: "Dropped", value: links.dropped, color: "var(--color-subtle-foreground)" },
    { label: "Expired", value: links.expired, color: "var(--color-border)" },
  ];
  const totalTokens = stats.usage.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-[22px] pb-16 pt-2 sm:px-6 lg:px-8 lg:pt-8">
      <h1 className="font-display text-[30px] font-[640] leading-[1.1] lg:text-4xl">Stats</h1>

      <div className="grid gap-x-16 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mt-[18px] flex items-end gap-3">
            <span className="font-display text-primary text-[64px] font-[680] leading-[0.9] tracking-[-0.023em] lg:text-[80px]">
              {answered}
            </span>
            <span className="text-muted-foreground pb-1 text-[15px] leading-[1.3]">
              {answered === 1 ? "card" : "cards"} answered
              <br />
              in the last 30 days
            </span>
          </div>

          <div className="border-border mt-[22px] grid grid-cols-3 border-y-[0.5px] py-4">
            <Figure art={<ScoreRing score={stats.averageScore} />}>
              {stats.averageScore === null ? "no answers yet" : "average score"}
            </Figure>
            <Figure art={<StreakFlame days={today.streak} />} divided>
              {today.streak === 0
                ? "no streak yet"
                : today.streak === 1
                  ? "day in a row"
                  : "days in a row"}
            </Figure>
            <Figure art={<ActiveDots days={stats.reviewsPerDay} />} divided>
              {active} of {days} days
            </Figure>
          </div>

          <Heading>Last 30 days</Heading>
          <StatsBars
            days={stats.reviewsPerDay}
            highlight="last"
            startLabel={stats.reviewsPerDay[0] ? shortDate(stats.reviewsPerDay[0].day) : ""}
            endLabel="Today"
            label={`Cards answered each day over the last 30 days, ${answered} in all.`}
          />

          <Heading>Coming up</Heading>
          <p className="text-muted-foreground text-[15px]">
            {dueToday + dueWeek === 0
              ? "Nothing due in the next week."
              : `${dueToday === 0 ? "Nothing" : dueToday} due today, ${dueWeek === 0 ? "nothing" : dueWeek} more this week.`}
          </p>
          <div className="mt-3.5">
            <StatsBars
              days={coming}
              highlight="first"
              startLabel="Today"
              endLabel={coming[coming.length - 1] ? shortDate(coming[coming.length - 1]!.day) : ""}
              label="Cards due on each of the next 14 days."
            />
          </div>
        </div>

        <div className="min-w-0 lg:pt-1">
          {questionDecks.length > 0 ? (
            <>
              <Heading>Decks</Heading>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <Legend color="var(--color-success)">Learned</Legend>
                <Legend color="color-mix(in srgb, var(--color-primary) 45%, transparent)">
                  Asked
                </Legend>
                <Legend color="var(--color-border)">Not asked yet</Legend>
              </div>
              <ul className="mt-1">
                {questionDecks.map((deck) => {
                  const fresh = deck.counts.new;
                  const asked = Math.max(0, deck.counts.total - deck.counts.learned - fresh);
                  return (
                    <li key={deck.id}>
                      <a
                        href={`/decks/${deck.id}`}
                        className="-mx-2 flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_60%,transparent)]"
                      >
                        <DeckStack
                          id={deck.id}
                          kind={deck.kind}
                          total={deck.counts.total}
                          learned={deck.counts.learned}
                          scale={0.8}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15.5px] font-semibold">{deck.name}</span>
                          <span className="mt-1.5">
                            <SplitBar
                              height={8}
                              parts={[
                                { value: deck.counts.learned, color: "var(--color-success)" },
                                {
                                  value: asked,
                                  color:
                                    "color-mix(in srgb, var(--color-primary) 45%, transparent)",
                                },
                                { value: fresh, color: "var(--color-border)" },
                              ]}
                            />
                          </span>
                          <span className="text-muted-foreground mt-[5px] text-[13px]">
                            {deck.counts.learned === deck.counts.total
                              ? `All ${deck.counts.total} learned`
                              : `${deck.counts.learned} of ${deck.counts.total} learned${fresh > 0 ? `, ${fresh} not asked yet` : ""}`}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {tags.length > 0 ? (
            <>
              <Heading>By topic</Heading>
              <p className="text-muted-foreground text-[15px]">Your written answers, by tag.</p>
              <div className="mt-3.5">
                <SplitBar
                  parts={BANDS.map((band, index) => ({
                    value: tags.filter(
                      (tag) =>
                        tag.averageScore < band.max &&
                        tag.averageScore >= (BANDS[index - 1]?.max ?? 0),
                    ).length,
                    color: band.color,
                  }))}
                />
              </div>
              {BANDS.map((band, index) => {
                const inBand = tags.filter(
                  (tag) =>
                    tag.averageScore < band.max && tag.averageScore >= (BANDS[index - 1]?.max ?? 0),
                );
                if (inBand.length === 0) return null;
                return (
                  <div key={band.name} className="mt-[18px]">
                    <p className="flex items-center gap-2">
                      <span className="size-2.5 rounded-[3px]" style={{ background: band.color }} />
                      <span className="text-[15px] font-semibold">{band.name}</span>
                      <span className="text-muted-foreground text-sm">{inBand.length}</span>
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {inBand.map((tag) => (
                        <span
                          key={tag.tag}
                          className="flex items-center gap-2 rounded-[10px] py-[7px] pl-3 pr-2.5 text-[14.5px]"
                          style={{
                            background: `light-dark(color-mix(in srgb, var(--color-canvas), ${band.color} 10%), color-mix(in srgb, var(--color-canvas), ${band.color} 18%))`,
                          }}
                        >
                          #{tag.tag}
                          <span className="font-bold tabular-nums" style={{ color: band.color }}>
                            {tag.averageScore}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}

          <Heading>Saved links</Heading>
          {linkParts.every((part) => part.value === 0) ? (
            <p className="text-muted-foreground text-[15px]">No links saved yet.</p>
          ) : (
            <>
              <SplitBar parts={linkParts} />
              <div className="mt-3 flex flex-wrap gap-x-[18px] gap-y-2.5">
                {linkParts
                  .filter((part) => part.value > 0)
                  .map((part) => (
                    <Legend key={part.label} color={part.color}>
                      {part.label} <span className="text-foreground font-bold">{part.value}</span>
                    </Legend>
                  ))}
              </div>
            </>
          )}

          {stats.usage.length > 0 ? (
            <>
              <Heading>AI usage</Heading>
              <p className="text-muted-foreground text-sm">
                {pluralize(totalTokens, "token")} in the last 30 days. Counted here, and it goes
                nowhere.
              </p>
              <table className="mt-3 w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="pb-1.5 font-medium">Task</th>
                    <th className="pb-1.5 text-right font-medium">Calls</th>
                    <th className="pb-1.5 text-right font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.usage.map((row) => (
                    <tr key={row.task} className="border-border border-t-[0.5px]">
                      <td className="py-2">{row.task.replace(/_/g, " ")}</td>
                      <td className="py-2 text-right tabular-nums">{row.calls}</td>
                      <td className="py-2 text-right tabular-nums">
                        {(row.inputTokens + row.outputTokens).toLocaleString("en")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display pb-2.5 pt-8 text-[17px] font-[640] tracking-[-0.006em] lg:text-xl">
      {children}
    </h2>
  );
}

function Figure({
  art,
  divided,
  children,
}: {
  art: React.ReactNode;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("flex flex-col items-center", divided && "border-border border-l-[0.5px]")}>
      <span className="grid h-[52px] place-items-center">{art}</span>
      <span className="text-muted-foreground mt-2 text-center text-[13px]">{children}</span>
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-[13.5px]">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {children}
    </span>
  );
}
