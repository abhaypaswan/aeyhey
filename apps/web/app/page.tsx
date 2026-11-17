// SPDX-License-Identifier: AGPL-3.0-only
// Home, as the phone app has it, laid out for whatever width it gets.
//
// No dashboard of boxes. The session leads, large, with a fan of its cards beside the
// count and one button. "Where you stand" is a shelf of three small drawings: glasses
// for the links waiting, a fan of deck cards, a flame for the streak. The week and the
// links coming up follow under quiet headings. On a phone that is one column with the
// paste box floating at the bottom, like the app; on a wide screen the paste box and the
// links up next move to a column of their own beside the session.

import { redirect } from "next/navigation";
import { repos, sessions } from "@aeyhey/core";
import { Bell, BellOff, ChevronRight, Play } from "lucide-react";
import { pageState } from "../lib/server";
import { LinkButton, cx } from "../components/ui";
import {
  CardFan,
  DayBars,
  DeckFan,
  LinkGlasses,
  SiteMark,
  StreakFlame,
} from "../components/drawings";
import { PasteBox } from "../components/paste-box";
import { hostOf, midSentence, pluralize } from "../lib/format";
import { strong } from "../lib/hue";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope } = state.context;
  const now = new Date();

  // The same numbers GET /api/today returns, so the phone app and this page agree.
  const today = await sessions.loadToday(scope, now);

  // Journal drafts waiting for a keep or drop, from the last two weeks.
  const twoWeeksAgo = new Date(now.getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  const journalDrafts = (await repos.listHighlights(scope, { from: twoWeeksAgo })).filter(
    (h) => h.status === "draft",
  ).length;

  const { paused, linkTotal, questionTotal, streak, links } = today;
  const nothingSaved = linkTotal + questionTotal === 0;
  const due = today.due.total > 0;
  const minutes = Math.min(60, Math.max(1, Math.ceil(today.sessionSize * 0.6)));
  const nextSession = midSentence(today.nextSessionLabel);

  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: today.timezone,
  }).format(now);

  const title = due
    ? `${pluralize(today.sessionSize, "card")} ready`
    : nothingSaved
      ? "Start with a link"
      : "All caught up";
  const body = due
    ? `${pluralize(today.due.links, "link")} and ${pluralize(today.due.questions, "question")} are waiting. About ${pluralize(minutes, "minute")}, one card at a time.`
    : nothingSaved
      ? "Paste any link. Aeyhey reads it, sums it up, and brings it back when you are likely to forget it."
      : paused
        ? "Reminders are paused. You can still do a few cards."
        : `Nothing is due. Next session ${nextSession}.`;

  const waiting = links.unread + links.snoozed;
  const linkCount = waiting + links.expiring;

  return (
    <main className="mx-auto w-full max-w-6xl px-[22px] pb-36 pt-4 sm:px-6 lg:px-8 lg:pb-20 lg:pt-10">
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col">
          <section aria-label="Today's session" className="flex flex-col">
            <p className="text-muted-foreground text-[13.5px] lg:text-sm">{date}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <h1 className="font-display min-w-0 flex-1 text-[34px] font-semibold leading-[1.08] tracking-[-0.018em] lg:text-[52px]">
                {title}
              </h1>
              {due ? (
                <span className="origin-right lg:scale-[1.35]">
                  <CardFan count={today.sessionSize} />
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-2.5 max-w-[46ch] text-[15.5px] leading-[1.45] lg:mt-4 lg:text-lg">
              {body}
            </p>

            {nothingSaved ? null : (
              <div className="mt-5 lg:mt-7 lg:flex lg:items-center lg:gap-5">
                {due ? (
                  <LinkButton
                    href="/session"
                    tone="primary"
                    size="lg"
                    icon={Play}
                    className="home-cta w-full lg:w-auto"
                  >
                    Start session
                  </LinkButton>
                ) : (
                  <LinkButton href="/session" size="lg" className="home-cta w-full lg:w-auto">
                    Do a few extra
                  </LinkButton>
                )}
                <ReminderLine
                  paused={paused}
                  nextSession={nextSession}
                  className="mt-3.5 lg:mt-0"
                />
              </div>
            )}
            {nothingSaved ? (
              <ReminderLine paused={paused} nextSession={nextSession} className="mt-3.5" />
            ) : null}

            {journalDrafts > 0 ? (
              <a
                href="/journal"
                className="text-muted-foreground hover:text-foreground mt-3 text-sm underline-offset-2 hover:underline"
              >
                {pluralize(journalDrafts, "highlight")} from your coding sessions{" "}
                {journalDrafts === 1 ? "is" : "are"} waiting in Journal.
              </a>
            ) : null}
          </section>

          {nothingSaved ? null : (
            <>
              <hr className="border-border mb-[22px] mt-[26px] border-t-[0.5px] lg:mb-8 lg:mt-10" />

              <section aria-label="Where you stand" className="flex items-stretch">
                <ShelfItem
                  href="/inbox"
                  className="flex-[5]"
                  art={<LinkGlasses waiting={waiting} expiring={links.expiring} />}
                  title={linkCount === 0 ? "No links" : pluralize(linkCount, "link")}
                  caption={
                    links.expiring > 0 ? (
                      <span className="font-semibold" style={{ color: strong("amber") }}>
                        {links.expiring} on last chance
                      </span>
                    ) : waiting > 0 ? (
                      "waiting to be read"
                    ) : (
                      "nothing waiting"
                    )
                  }
                />
                <ShelfItem
                  href="/decks"
                  className="flex-[4] border-l-[0.5px]"
                  art={<DeckFan decks={today.questionDeckCount} />}
                  title={
                    questionTotal === 0 ? "No questions" : pluralize(questionTotal, "question")
                  }
                  caption={
                    questionTotal === 0
                      ? "make a deck"
                      : `in ${pluralize(today.questionDeckCount, "deck")}`
                  }
                />
                <ShelfItem
                  className="flex-[4] border-l-[0.5px]"
                  art={<StreakFlame days={streak} />}
                  title={streak === 0 ? "No streak" : "day streak"}
                  caption={streak === 0 ? "do a session" : "keep it going"}
                />
              </section>

              <section aria-label="This week" className="mt-[30px] lg:mt-12">
                <h2 className="font-display text-[17px] font-[640] tracking-[-0.006em] lg:text-xl">
                  This week
                </h2>
                <div className="mt-3.5 lg:mt-5">
                  <DayBars
                    days={today.week}
                    height={96}
                    label={`Cards due over the next 7 days: ${today.week.map((row) => row.count).join(", ")}.`}
                  />
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-8 lg:pt-1">
          <PasteBox />

          {today.queue.length > 0 ? (
            <section aria-label="Up next">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-[17px] font-[640] tracking-[-0.006em] lg:text-xl">
                  Up next
                </h2>
                <a
                  href="/inbox"
                  className="text-primary hidden text-sm font-semibold hover:underline lg:inline"
                >
                  Open Inbox
                </a>
              </div>
              <ul className="mt-1">
                {today.queue.map((item, index) => (
                  <li key={item.id}>
                    <a
                      href={`/links/${item.id}`}
                      className="group -mx-2 flex items-center gap-3 rounded-xl px-2 transition-colors lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_70%,transparent)]"
                    >
                      <SiteMark url={item.url} siteName={item.siteName} />
                      <span
                        className={cx(
                          "flex min-w-0 flex-1 items-center gap-3 py-3.5",
                          index > 0 && "border-border border-t-[0.5px]",
                        )}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-display truncate text-[17px] font-[560] leading-[1.2]">
                            {item.title ?? item.url}
                          </span>
                          <span className="text-muted-foreground truncate text-[12.5px]">
                            {item.siteName ?? hostOf(item.url)}
                            {item.readMinutes ? ` · ${item.readMinutes} min` : ""}
                          </span>
                        </span>
                        <ChevronRight
                          size={18}
                          aria-hidden="true"
                          className="text-subtle-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function ReminderLine({
  paused,
  nextSession,
  className,
}: {
  paused: boolean;
  nextSession: string;
  className?: string;
}) {
  const Icon = paused ? BellOff : Bell;
  return (
    <p className={cx("text-muted-foreground flex min-w-0 items-center gap-2 text-sm", className)}>
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        {paused ? "Reminders are paused" : `Next reminder ${nextSession}`}
      </span>
      <a
        href="/settings"
        className="text-primary rounded-md px-1.5 py-1 font-semibold hover:underline"
      >
        Change
      </a>
    </p>
  );
}

function ShelfItem({
  href,
  art,
  title,
  caption,
  className,
}: {
  href?: string;
  art: React.ReactNode;
  title: string;
  caption: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span className="grid h-[46px] place-items-end justify-center">{art}</span>
      <span className="font-display mt-2.5 truncate text-[16px] font-semibold leading-[1.2] lg:text-lg">
        {title}
      </span>
      <span className="text-muted-foreground mt-px truncate text-[12.5px] lg:text-sm">
        {caption}
      </span>
    </>
  );
  const shared = cx(
    "border-border flex min-w-0 flex-col items-center px-1 pb-1.5 pt-1 text-center",
    className,
  );
  return href ? (
    <a
      href={href}
      className={cx(
        shared,
        "rounded-[10px] transition-colors lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_70%,transparent)]",
      )}
    >
      {inner}
    </a>
  ) : (
    <div className={shared}>{inner}</div>
  );
}
