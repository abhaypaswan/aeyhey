// SPDX-License-Identifier: AGPL-3.0-only
// Today, the home screen (PRD 12.1 screen 2).
//
// One obvious thing to do, given the room it deserves, and around it everything that
// answers "where do I stand": what is waiting, what is coming, and what to try next if
// you are new. Still not a feed: nothing here scrolls without end.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repos, sessions } from "@aeyhey/core";
import { pageState } from "../lib/server";
import {
  Bar,
  Button,
  Card,
  CardTitle,
  LinkButton,
  Notice,
  Page,
  PageHeader,
  StatTile,
  StatusPill,
  cx,
} from "../components/ui";
import { DismissButton } from "../components/dismiss";
import { HOW_IT_WORKS_STEPS } from "../components/how-it-works-steps";
import { QuickAdd } from "../components/quick-add";
import {
  Brain,
  Check,
  ChevronRight,
  Clock,
  Flame,
  Link2,
  Play,
  Sparkles,
  SiteIcon,
} from "../components/icons";
import { hostOf, midSentence, pluralize } from "../lib/format";

export const dynamic = "force-dynamic";

const HIDE_START_COOKIE = "aeyhey_hide_start";
const HIDE_HOW_COOKIE = "aeyhey_hide_how";

export default async function TodayPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope, user } = state.context;
  const now = new Date();

  // The same numbers GET /api/today returns, so the phone app and this page agree.
  const [today, jar] = await Promise.all([sessions.loadToday(scope, now), cookies()]);

  // Journal drafts waiting for a keep or drop (PRD 29), from the last two weeks.
  const twoWeeksAgo = new Date(now.getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  const journalDrafts = (await repos.listHighlights(scope, { from: twoWeeksAgo })).filter(
    (h) => h.status === "draft",
  ).length;

  const { paused, linkTotal, questionTotal, streak } = today;
  const counts = { linksDue: today.due.links, questionsDue: today.due.questions };
  const links = today.links;
  const dueTotal = today.due.total;
  const sessionSize = today.sessionSize;
  const nextSession = midSentence(today.nextSessionLabel);

  // The first-run checklist. Each step is ticked from what is actually in the database,
  // so it can never claim something the user has not done.
  const steps = [
    {
      title: "Save your first links",
      body: "Paste any URLs. Aeyhey summarises and tags each one.",
      href: "/add",
      done: linkTotal > 0,
    },
    {
      title: "Do your first session",
      body: "A handful of cards, about two minutes.",
      href: "/session",
      done: today.totalReviews > 0,
    },
    {
      title: "Make a question deck",
      body: "From a few topics, or from your resume.",
      href: "/decks",
      done: today.questionDeckCount > 0,
    },
    {
      title: "Turn on reminders",
      body: "Browser notifications, Telegram or email.",
      href: "/settings/notifications",
      done: today.hasPushDevice,
    },
  ];
  const stepsDone = steps.filter((step) => step.done).length;
  const showStart = stepsDone < steps.length && !jar.get(HIDE_START_COOKIE);
  const showHow = today.totalReviews === 0 && !jar.get(HIDE_HOW_COOKIE);

  const week = today.week;
  const weekPeak = Math.max(1, ...week.map((row) => row.count));

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: today.timezone,
    }).format(now),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const hero = (
    <Card
      padding="none"
      className="flex flex-col justify-between gap-8 p-6 max-lg:order-1 max-sm:gap-5 max-sm:p-5 lg:p-8"
    >
      {dueTotal > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            <p className="text-subtle-foreground text-2xs font-bold uppercase tracking-[0.08em]">
              Today&apos;s session
            </p>
            <p className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              {pluralize(sessionSize, "card")} ready
            </p>
            {/* The long version is for a screen with room. On a phone the chips below say
                what is in the session, and the checklist says the rest. */}
            <p className="text-muted-foreground text-sm sm:hidden">
              One card at a time, about two minutes.
            </p>
            <p className="text-muted-foreground max-w-[52ch] text-sm max-sm:hidden lg:text-base">
              One card at a time. For a link you decide: read it now, see it later, or drop it. For
              a question you answer and get a score. Aeyhey schedules the rest.
            </p>
            <ul className="mt-1 flex flex-wrap gap-2">
              <HeroChip icon={Link2}>{pluralize(counts.linksDue, "link")}</HeroChip>
              <HeroChip icon={Brain}>{pluralize(counts.questionsDue, "question")}</HeroChip>
              <HeroChip icon={Clock}>
                about {Math.max(1, Math.round(sessionSize * 0.6))} min
              </HeroChip>
            </ul>
          </div>
          <form action="/session" className="flex flex-wrap items-center gap-3">
            <Button tone="primary" size="lg" type="submit" icon={Play} className="max-sm:w-full">
              Start session
            </Button>
            <span className="text-subtle-foreground text-xs">
              {paused ? "Reminders are paused." : `Next reminder ${nextSession}.`}
            </span>
          </form>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <span className="bg-success-soft text-success grid size-12 place-items-center rounded-2xl">
              <Sparkles size={22} aria-hidden="true" />
            </span>
            <p className="text-3xl font-extrabold tracking-tight">
              {linkTotal + questionTotal === 0 ? "Nothing saved yet" : "You are all caught up"}
            </p>
            <p className="text-muted-foreground max-w-[52ch] text-sm lg:text-base">
              {linkTotal + questionTotal === 0
                ? "Save a few links or make a deck of questions, and your first session will be waiting here."
                : paused
                  ? "Reminders are paused. You can still do a session whenever you like."
                  : `Nothing is due. Come back ${nextSession}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {linkTotal + questionTotal === 0 ? (
              <>
                <LinkButton href="/add" tone="primary" size="lg" icon={Link2}>
                  Add links
                </LinkButton>
                <LinkButton href="/decks" size="lg" icon={Brain}>
                  Make a deck
                </LinkButton>
              </>
            ) : (
              <form action="/session">
                <Button type="submit" size="lg" icon={Play}>
                  Do a few extra
                </Button>
              </form>
            )}
          </div>
        </>
      )}
    </Card>
  );

  return (
    <Page>
      <PageHeader
        title={user.displayName === "You" ? greeting : `${greeting}, ${user.displayName}`}
        subtitle="Aeyhey brings back the links you saved and the questions you are learning, a few cards at a time."
      />

      {journalDrafts > 0 ? (
        <Notice tone="info">
          {pluralize(journalDrafts, "highlight")} from your coding sessions{" "}
          {journalDrafts === 1 ? "is" : "are"} waiting.{" "}
          <a href="/journal" className="text-primary font-semibold underline">
            Review in Journal
          </a>
        </Notice>
      ) : null}

      <div
        className={cx(
          // On a phone this wrapper steps aside (display: contents), so the session card,
          // the numbers and the checklist can be put in the order that suits a small
          // screen: what to do, where you stand, then the help.
          "grid items-stretch gap-6 max-lg:contents",
          showStart && "xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,1fr)]",
        )}
      >
        {hero}

        {showStart ? (
          <Card className="flex flex-col gap-3 max-lg:order-3">
            <CardTitle
              hint={`${stepsDone} of ${steps.length} done`}
              action={<DismissButton cookie={HIDE_START_COOKIE} />}
            >
              Getting started
            </CardTitle>
            <Bar kind="progress" label="Getting started" value={(stepsDone / steps.length) * 100} />
            <ol className="-mx-2 flex flex-col">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <a
                    href={step.href}
                    className="hover:bg-sunken flex items-start gap-3 rounded-lg p-2 transition-colors"
                  >
                    <span
                      className={cx(
                        "text-2xs size-5.5 mt-0.5 grid shrink-0 place-items-center rounded-full border-2 font-extrabold",
                        step.done
                          ? "border-success bg-success text-white"
                          : "border-border-strong text-subtle-foreground",
                      )}
                    >
                      {step.done ? <Check size={12} aria-hidden="true" /> : index + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cx(
                          "text-sm font-semibold",
                          step.done && "text-subtle-foreground line-through",
                        )}
                      >
                        {step.title}
                        {step.done ? <span className="sr-only"> (done)</span> : null}
                      </span>
                      <span className="text-muted-foreground text-xs">{step.body}</span>
                    </span>
                    {step.done ? null : (
                      <ChevronRight
                        size={15}
                        aria-hidden="true"
                        className="text-subtle-foreground mt-1 shrink-0"
                      />
                    )}
                  </a>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>

      <section
        aria-label="Where you stand"
        className="grid grid-cols-2 gap-3 max-lg:order-2 lg:grid-cols-4 lg:gap-4"
      >
        <StatTile
          icon={Link2}
          label="Links to read"
          value={links.unread + links.snoozed}
          detail={
            links.snoozed > 0 ? `${links.snoozed} set aside for later` : "Waiting in your inbox"
          }
          href="/inbox?status=unread"
        />
        <StatTile
          icon={Brain}
          label="Questions"
          value={questionTotal}
          detail={questionTotal === 0 ? "Make a deck to start" : `${counts.questionsDue} due now`}
          href="/decks"
        />
        <StatTile
          icon={Clock}
          label="Last chance"
          value={links.expiring}
          detail="Links about to expire"
          href="/inbox?status=expiring"
          tone={links.expiring > 0 ? "warning" : "default"}
        />
        <StatTile
          icon={Flame}
          label="Streak"
          value={streak}
          detail={streak === 1 ? "day in a row" : "days in a row"}
          href="/stats"
        />
      </section>

      {/* A single column on a phone, and it has to be told it may shrink: left to size
          itself it grows to fit the longest link title and pushes the page sideways. */}
      <div className="grid items-start gap-6 max-lg:order-4 max-lg:grid-cols-[minmax(0,1fr)] lg:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 lg:col-span-2 xl:col-span-1">
          <CardTitle
            hint="The links most likely to come up next."
            action={
              <a href="/inbox" className="text-primary text-xs font-semibold hover:underline">
                Open inbox
              </a>
            }
          >
            Up next in your queue
          </CardTitle>
          {today.queue.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No unread links. Paste one into quick add and it will show up here.
            </p>
          ) : (
            <ul className="divide-border -my-4 flex flex-col divide-y">
              {today.queue.map((item) => (
                <li key={item.id}>
                  <a href={`/links/${item.id}`} className="group flex gap-3 py-4">
                    <SiteIcon url={item.url} siteName={item.siteName} size={32} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold group-hover:underline">
                        {item.title ?? item.url}
                      </span>
                      {item.summary ? (
                        <span className="text-muted-foreground clamp-2 text-xs">
                          {item.summary}
                        </span>
                      ) : null}
                      <span className="text-subtle-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <StatusPill status={item.status} />
                        {item.siteName ?? hostOf(item.url)}
                        {item.readMinutes ? ` · ${item.readMinutes} min` : ""}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <CardTitle hint="Cards due each day this week.">Coming up</CardTitle>
          <div
            className="flex h-32 items-end gap-2"
            role="img"
            aria-label={`Cards due over the next 7 days: ${week.map((row) => row.count).join(", ")}.`}
          >
            {week.map((row, index) => (
              <div key={row.day} className="flex h-full flex-1 flex-col items-center gap-1.5">
                <span className="text-subtle-foreground text-2xs tabular-nums">{row.count}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cx(
                      "min-h-1 w-full rounded-md",
                      index === 0 ? "bg-primary" : "bg-primary-soft",
                    )}
                    style={{ height: `${(row.count / weekPeak) * 100}%` }}
                  />
                </div>
                <span className="text-subtle-foreground text-2xs">
                  {index === 0 ? "Today" : weekday(row.day)}
                </span>
              </div>
            ))}
          </div>
          <a href="/stats" className="text-primary text-xs font-semibold hover:underline">
            See all stats
          </a>
        </Card>

        <QuickAdd />
      </div>

      {showHow ? (
        <section aria-label="How Aeyhey works" className="flex flex-col gap-3 max-lg:order-5">
          <div className="flex items-center justify-between">
            <h2 className="text-subtle-foreground text-2xs font-bold uppercase tracking-[0.08em]">
              How Aeyhey works
            </h2>
            <DismissButton cookie={HIDE_HOW_COOKIE} />
          </div>
          <Card padding="none">
            <ol className="divide-border grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              {HOW_IT_WORKS_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3.5 p-5">
                  <span className="bg-primary-soft text-primary grid size-8 shrink-0 place-items-center rounded-lg text-sm font-extrabold">
                    {index + 1}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-bold">{step.title}</span>
                    <span className="text-muted-foreground text-sm">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      ) : null}
    </Page>
  );
}

function HeroChip({
  icon: IconComponent,
  children,
}: {
  icon: typeof Link2;
  children: React.ReactNode;
}) {
  return (
    <li className="border-border bg-sunken text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold">
      <IconComponent size={13} aria-hidden="true" />
      {children}
    </li>
  );
}

function weekday(day: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}
