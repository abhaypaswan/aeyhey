// SPDX-License-Identifier: AGPL-3.0-only
// Someone's public reading profile (PRD 28): who they are, how steadily they read, what
// about, and what they took from each thing. Laid out for a phone first; on a wide
// screen the person moves into a column on the left.
//
// Server-rendered; the share button is the only client JavaScript. Off and missing pages
// look the same: a 404.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import type { repos } from "@aeyhey/core";
import { loadPublicPage } from "../../../lib/public-page";
import { PrintButton } from "./print-button";
import { DayFeed } from "./day-feed";
import { ShareButton } from "./share-button";
import styles from "./profile.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Stats = NonNullable<repos.PublicPage["stats"]>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function cursorFrom(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length < 200 ? value : null;
}

/** Short words that read as acronyms, kept in capitals in topic names. */
const ACRONYMS = new Set([
  "ai",
  "api",
  "aws",
  "css",
  "dns",
  "gpu",
  "llm",
  "ml",
  "sql",
  "tls",
  "ui",
  "ux",
]);

/** "api-design" as "API design": words split on hyphens, acronyms in capitals. */
function topicLabel(tag: string): string {
  const words = tag.split("-").map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
  const first = words[0] ?? "";
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/** "20 Oct" from YYYY-MM-DD or an ISO time. */

function dayMonth(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function describe(page: repos.PublicPage): string {
  if (page.bio) return page.bio;
  const stats = page.stats;
  if (stats && stats.takeaways > 0) {
    return `${stats.linksRead} links read, ${stats.takeaways} takeaways shared, a ${stats.longestStreak}-day best streak.`;
  }
  return `What @${page.handle} reads, and the one thing they take from each.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const result = await loadPublicPage(handle);
  if (result.kind !== "page") return { title: "Not found", robots: { index: false } };

  const { page, pageUrl } = result;
  const description = describe(page);
  const title = page.name ? `${page.name} (@${page.handle})` : page.title;
  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      types: { "application/rss+xml": `${pageUrl}/rss.xml` },
    },
    openGraph: { title, description, url: pageUrl, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
    robots: page.indexable ? { index: true, follow: false } : { index: false, follow: false },
  };
}

// ---------------------------------------------------------------- pieces

function Icon({ path, size = 15 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const LINK =
  "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7";
const RSS = "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01";
const BOOK = "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z";
const BRIEFCASE =
  "M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2";
const FOLDER =
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z";
const CODE = "M16 18l6-6-6-6M8 6l-6 6 6 6";
const HEART =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z";
const STAR =
  "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z";

/** Colours handed out in turn, so neighbouring companies and projects differ. */
const PALETTE = [
  styles.toneSky,
  styles.toneLesson,
  styles.toneDone,
  styles.toneGoing,
  styles.toneRose,
  styles.toneLearn,
];

/** A heading's small tinted icon. */
function TitleIcon({ path }: { path: string }) {
  return (
    <span className={styles.titleIcon} aria-hidden="true">
      <Icon path={path} size={13} />
    </span>
  );
}

function Flame() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fb923c" aria-hidden="true">
      <path d="M12 2c.6 3.4-1.4 5.3-2.9 7C7.6 10.7 6 12.6 6 15.3 6 18.9 8.7 22 12 22s6-3 6-6.7c0-2.3-1.1-4.2-2.2-5.4-.3 1.4-1 2.5-2.1 3 .4-3.6-.6-7.6-1.7-10.9Z" />
    </svg>
  );
}

function heat(count: number): string {
  if (count === 0) return styles.heat0!;
  if (count === 1) return styles.heat1!;
  if (count <= 3) return styles.heat2!;
  return styles.heat3!;
}

/**
 * Days as small squares, one block per month with a gap between months, like a
 * contribution graph: rows are weekdays (Sunday on top), columns are the month's weeks.
 */
function ActivityGrid({
  start,
  counts,
  className,
}: {
  start: string;
  counts: number[];
  className: string;
}) {
  const first = Date.parse(`${start}T00:00:00Z`);
  const months: {
    key: string;
    label: string;
    cells: { row: number; col: number; count: number }[];
  }[] = [];
  for (let i = 0; i < counts.length; i += 1) {
    const date = new Date(first + i * 86_400_000);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    let month = months[months.length - 1];
    if (!month || month.key !== key) {
      month = { key, label: MONTHS[date.getUTCMonth()]!, cells: [] };
      months.push(month);
    }
    const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const col = Math.floor((date.getUTCDate() - 1 + firstOfMonth.getUTCDay()) / 7);
    month.cells.push({ row: date.getUTCDay(), col, count: counts[i]! });
  }
  // Each month gets a share of the width in proportion to its week columns, and its
  // squares fill that share, so the grid always fits the card exactly.
  const columns = months.map((month) => Math.max(...month.cells.map((cell) => cell.col)) + 1);
  return (
    <div
      className={`${styles.months} ${className}`}
      style={{ gridTemplateColumns: columns.map((n) => `${n}fr`).join(" ") }}
      aria-hidden="true"
    >
      {months.map((month, i) => (
        <div key={month.key} className={styles.month}>
          <div
            className={styles.monthGrid}
            style={{ gridTemplateColumns: `repeat(${columns[i]}, minmax(0, 1fr))` }}
          >
            {month.cells.map((cell) => (
              <span
                key={`${cell.col}-${cell.row}`}
                className={`${styles.cell} ${heat(cell.count)}`}
                style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
              />
            ))}
          </div>
          <span className={styles.monthLabel}>{month.label}</span>
        </div>
      ))}
    </div>
  );
}

function Delta({ gained, unit = "" }: { gained: number; unit?: string }) {
  return gained > 0 ? (
    <span className={styles.statDelta}>
      +{gained.toLocaleString("en")}
      {unit} in 30 days
    </span>
  ) : (
    <span className={styles.statQuiet}>Quiet this month</span>
  );
}

/** The streak, with the last seven days as bars, on a warm panel. */
function StreakPanel({ stats }: { stats: Stats }) {
  const week = stats.activity.counts.slice(-7);
  const tallest = Math.max(1, ...week);
  const going = stats.currentStreak > 1;
  return (
    <div className={styles.streakPanel}>
      <span className={styles.streakLabel}>
        <Flame />
        {going ? "Current streak" : "Longest streak"}
      </span>
      <span className={styles.streakValue}>
        {going ? stats.currentStreak : stats.longestStreak}
        <span className={styles.streakUnit}> days</span>
      </span>
      <span className={styles.streakNote}>
        {going && stats.currentStreak >= stats.longestStreak
          ? `Longest yet. Every day since ${dayMonth(stats.streakStart ?? "")}.`
          : going
            ? `Best so far: ${stats.longestStreak} days.`
            : "Read again today to start a new one."}
      </span>
      <div className={styles.week} aria-hidden="true">
        {week.map((count, i) => (
          <span
            key={i}
            className={`${styles.weekBar} ${i === week.length - 1 ? styles.weekBarToday : ""} ${count === 0 ? styles.weekBarEmpty : ""}`}
            style={{ height: `${count === 0 ? 6 : 10 + 30 * (count / tallest)}px` }}
          />
        ))}
      </div>
    </div>
  );
}

/** One labelled row of numbers, such as Reading or Building. */
function StatGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    // Both rows use the same indigo heading: they are the same kind of label, and green
    // stays for growth alone.
    <div className={`${styles.statGroup} ${styles.toneLearn}`}>
      <span className={styles.statGroupTitle}>
        <span className={styles.statGroupDot} aria-hidden="true" />
        {title}
      </span>
      {children}
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {children}
    </div>
  );
}

/**
 * The numbers at a glance: the streak, then reading and, when the owner shows it,
 * building with coding agents. One card, two labelled rows.
 */
function Overview({
  stats,
  building,
}: {
  stats: Stats | null;
  building: repos.PublicPage["building"];
}) {
  return (
    <section className={`${styles.card} ${styles.overview}`} aria-label="At a glance">
      {stats ? <StreakPanel stats={stats} /> : null}
      <div className={styles.overviewGroups}>
        {stats ? (
          <StatGroup title="Reading">
            <dl className={styles.statRow}>
              <Stat label="Active days" value={stats.daysActive.toLocaleString("en")}>
                <Delta gained={stats.recent.days} />
              </Stat>
              <Stat label="Links read" value={stats.linksRead.toLocaleString("en")}>
                <Delta gained={stats.recent.links} />
              </Stat>
              <Stat
                label="Hours reading"
                value={Math.floor(stats.minutesRead / 60).toLocaleString("en")}
              >
                <Delta gained={Math.floor(stats.recent.minutes / 60)} />
              </Stat>
            </dl>
          </StatGroup>
        ) : null}
        {building ? (
          <StatGroup title="Building with coding agents">
            <dl className={styles.statRow}>
              <Stat
                label="Hours"
                value={Math.floor(building.activeMinutes / 60).toLocaleString("en")}
              >
                <Delta gained={Math.floor(building.recent.minutes / 60)} />
              </Stat>
              <Stat label="Days" value={building.daysBuilding.toLocaleString("en")}>
                <Delta gained={building.recent.days} />
              </Stat>
              <Stat
                label="Lines changed"
                value={(building.linesAdded + building.linesRemoved).toLocaleString("en")}
              >
                <span className={styles.statQuiet}>
                  <span className={styles.linesAdded}>
                    +{building.linesAdded.toLocaleString("en")}
                  </span>{" "}
                  <span className={styles.linesRemoved}>
                    -{building.linesRemoved.toLocaleString("en")}
                  </span>
                </span>
              </Stat>
            </dl>
            {building.languages.length > 0 || building.models ? (
              <ul className={styles.statChips}>
                {building.languages.map((ext) => (
                  <li key={ext}>{ext}</li>
                ))}
                {(building.models ?? []).map((model) => (
                  <li key={model.name}>
                    {model.name} <span>{model.share}%</span>
                  </li>
                ))}
                {building.tokens !== null ? (
                  <li>
                    {(building.tokens / 1_000_000).toFixed(1)}M <span>tokens</span>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </StatGroup>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the page

export default async function PublicProfilePage({ params, searchParams }: Props) {
  const { handle } = await params;
  const cursor = cursorFrom((await searchParams)["cursor"]);
  const result = await loadPublicPage(handle, cursor);

  if (result.kind === "moved") permanentRedirect(`/u/${result.handle}`);
  if (result.kind === "missing") notFound();

  const { page, pageUrl } = result;
  const stats = page.stats;
  const name = page.name ?? `@${page.handle}`;
  const initial = (page.name ?? page.handle).charAt(0).toUpperCase();
  const since = stats ? new Date(stats.since) : null;
  const sinceLabel = since
    ? `Reading since ${MONTH_NAMES[since.getUTCMonth()]} ${since.getUTCFullYear()}`
    : null;
  const mostly =
    stats && stats.topics.length > 0
      ? `Mostly ${stats.topics
          .slice(0, 2)
          .map((topic) => topic.name.replace(/-/g, " "))
          .join(" and ")}`
      : null;

  const narrowStart = stats
    ? new Date(
        Date.parse(`${stats.activity.start}T00:00:00Z`) +
          (stats.activity.counts.length - 91) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)
    : "";
  const activeNarrow = stats
    ? stats.activity.counts.slice(-91).filter((count) => count > 0).length
    : 0;
  // Desktop shows the last nine months: in this column a full year would make the
  // squares too small to read. Phones show the last three.
  const WIDE_DAYS = 273;
  const wideCounts = stats ? stats.activity.counts.slice(-WIDE_DAYS) : [];
  const wideStart = stats
    ? new Date(
        Date.parse(`${stats.activity.start}T00:00:00Z`) +
          (stats.activity.counts.length - wideCounts.length) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)
    : "";
  const activeWide = wideCounts.filter((count) => count > 0).length;

  const chipCard = (
    id: string,
    title: string,
    values: string[],
    tone: string | undefined,
    icon: string,
  ) =>
    values.length > 0 ? (
      <section className={`${styles.card} ${styles.tinted} ${tone}`} aria-labelledby={id}>
        <div className={styles.sectionHead}>
          <h2 id={id} className={`${styles.sectionTitle} ${styles.titled}`}>
            <TitleIcon path={icon} />
            {title}
          </h2>
        </div>
        <ul className={styles.chips}>
          {values.map((value) => (
            <li key={value} className={styles.chip}>
              {value}
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const skillsCard = chipCard("skills", "Skills", page.skills, styles.toneDone, CODE);
  const interestsCard = chipCard("interests", "Interests", page.interests, styles.toneRose, HEART);
  // Rendered twice (side column on a wide screen, the content column on a phone), so
  // each copy gets its own heading id.
  const milestonesCard = (id: string) =>
    stats && stats.milestones.length > 0 ? (
      <section className={`${styles.card} ${styles.toneGoing}`} aria-labelledby={id}>
        <div className={styles.sectionHead}>
          <h2 id={id} className={`${styles.sectionTitle} ${styles.titled}`}>
            <TitleIcon path={STAR} />
            Milestones
          </h2>
        </div>
        <ul className={styles.milestones}>
          {stats.milestones.slice(0, 5).map((milestone) => (
            <li key={milestone.kind} className={styles.milestone}>
              <span
                className={`${styles.badge} ${styles[`badge_${milestone.kind}`]}`}
                aria-hidden="true"
              >
                {milestone.value}
              </span>
              <span className={styles.milestoneText}>
                <span className={styles.milestoneLabel}>{milestone.label}</span>
                {milestone.reachedOn ? (
                  <span className={styles.milestoneWhen}>
                    Reached {dayMonth(milestone.reachedOn)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const share = <ShareButton url={pageUrl} title={name} />;
  const follow = (
    <a className={styles.button} href={`/u/${page.handle}/rss.xml`}>
      <Icon path={RSS} />
      Follow
    </a>
  );

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <header className={styles.profile}>
          <div className={styles.profileTop}>
            <span className={styles.avatar} aria-hidden="true">
              {page.avatarUrl ? (
                // A small stored picture with a versioned URL: next/image would add a
                // resize step for nothing.
                <img className={styles.avatarImage} src={page.avatarUrl} alt="" />
              ) : (
                initial
              )}
            </span>
            <div className={`${styles.buttons} ${styles.buttonsNarrow} ${styles.noPrint}`}>
              {follow}
              {share}
            </div>
          </div>
          <div>
            <h1 className={styles.name}>{name}</h1>
            {page.headline ? <p className={styles.headline}>{page.headline}</p> : null}
            <div className={styles.handleLine}>
              {page.name ? <span>@{page.handle}</span> : null}
              {page.location ? <span>{page.location}</span> : null}
              {sinceLabel ? <span>{sinceLabel}</span> : null}
            </div>
          </div>
          {page.bio ? <p className={styles.bio}>{page.bio}</p> : null}
          {page.links.length > 0 ? (
            <ul className={styles.links} aria-label="Links">
              {page.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} rel="noopener noreferrer me" target="_blank">
                    <Icon path={LINK} size={14} />
                    {link.label}
                    <span className={styles.printOnly}>
                      {" "}
                      {link.url.replace(/^https?:\/\//, "")}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={`${styles.buttons} ${styles.buttonsWide} ${styles.noPrint}`}>
            {share}
            {follow}
            <PrintButton className={styles.button!} />
          </div>
          {mostly ? (
            <div className={styles.facts}>
              {mostly ? (
                <span className={styles.fact}>
                  <Icon path={BOOK} size={16} />
                  {mostly}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className={styles.sideCards}>
            {skillsCard}
            {interestsCard}
            {milestonesCard("milestones-side")}
          </div>
        </header>

        <main className={styles.content}>
          <div className={styles.workBlock}>
            {page.experience.length > 0 ? (
              <section className={`${styles.card} ${styles.toneSky}`} aria-labelledby="experience">
                <div className={styles.sectionHead}>
                  <h2 id="experience" className={`${styles.sectionTitle} ${styles.titled}`}>
                    <TitleIcon path={BRIEFCASE} />
                    Experience
                  </h2>
                </div>
                <ol className={styles.timeline}>
                  {page.experience.map((job, i) => (
                    <li
                      key={`${job.company}-${job.role}-${i}`}
                      className={`${styles.job} ${styles.tinted} ${PALETTE[i % PALETTE.length]}`}
                    >
                      <span className={styles.jobMark} aria-hidden="true">
                        {job.company.charAt(0).toUpperCase()}
                      </span>
                      <div className={styles.jobText}>
                        <div className={styles.jobHead}>
                          <span className={styles.jobRole}>{job.role}</span>
                          {job.start || job.end !== undefined ? (
                            <span className={styles.jobWhen}>
                              {job.start}
                              {job.start ? " to " : ""}
                              {job.end ??
                                (job.start ? (
                                  <span className={styles.jobPresent}>Present</span>
                                ) : null)}
                            </span>
                          ) : null}
                        </div>
                        <span className={styles.jobCompany}>{job.company}</span>
                        {job.summary ? <p className={styles.jobSummary}>{job.summary}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {page.projects.length > 0 ? (
              <section aria-labelledby="projects" className={styles.projectsSection}>
                <div className={`${styles.takeawaysHead} ${styles.toneLesson}`}>
                  <h2 id="projects" className={`${styles.takeawaysTitle} ${styles.titled}`}>
                    <TitleIcon path={FOLDER} />
                    Projects
                  </h2>
                </div>
                <ul className={styles.items}>
                  {page.projects.map((project, i) => (
                    <li key={project.name}>
                      <article
                        className={`${styles.card} ${styles.item} ${styles.projectCard} ${styles.tinted} ${PALETTE[(i + 1) % PALETTE.length]}`}
                      >
                        <h3 className={styles.itemTitle}>
                          {project.url ? (
                            <a href={project.url} rel="noopener noreferrer" target="_blank">
                              {project.name}
                            </a>
                          ) : (
                            project.name
                          )}
                        </h3>
                        {project.description ? (
                          <p className={styles.takeaway}>{project.description}</p>
                        ) : null}
                        {project.tech && project.tech.length > 0 ? (
                          <ul className={styles.techList}>
                            {project.tech.map((tech) => (
                              <li key={tech}>{tech}</li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {page.skills.length > 0 || page.interests.length > 0 ? (
              <div className={`${styles.pair} ${styles.hideWide}`}>
                {skillsCard}
                {interestsCard}
              </div>
            ) : null}
          </div>

          <div className={styles.statsBlock}>
            {stats ? (
              <>
                <Overview stats={stats} building={page.building} />

                <section className={styles.card} aria-labelledby="activity">
                  <div className={styles.sectionHead}>
                    <h2 id="activity" className={styles.sectionTitle}>
                      Activity
                    </h2>
                    <span className={`${styles.sectionNote} ${styles.onlyNarrow}`}>
                      {activeNarrow} of the last 91 days
                    </span>
                    <span className={`${styles.sectionNote} ${styles.onlyWide}`}>
                      {activeWide} active days in the last nine months
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`Active on ${activeWide} of the last ${wideCounts.length} days`}
                  >
                    <ActivityGrid
                      className={`${styles.gridNarrow} ${styles.onlyNarrow}`}
                      start={narrowStart}
                      counts={stats.activity.counts.slice(-91)}
                    />
                    <ActivityGrid
                      className={`${styles.gridWide} ${styles.onlyWide}`}
                      start={wideStart}
                      counts={wideCounts}
                    />
                  </div>
                  <div className={styles.gridFoot}>
                    <span className={styles.legend} aria-hidden="true">
                      Less
                      <span className={`${styles.cell} ${styles.heat0}`} />
                      <span className={`${styles.cell} ${styles.heat1}`} />
                      <span className={`${styles.cell} ${styles.heat2}`} />
                      <span className={`${styles.cell} ${styles.heat3}`} />
                      More
                    </span>
                  </div>
                </section>

                {stats.topics.length > 0 || stats.milestones.length > 0 ? (
                  <div className={`${styles.pair} ${styles.pairStats}`}>
                    {stats.topics.length > 0 ? (
                      <section
                        className={`${styles.card} ${styles.tinted} ${styles.toneLearn}`}
                        aria-labelledby="topics"
                      >
                        <div className={styles.sectionHead}>
                          <h2 id="topics" className={`${styles.sectionTitle} ${styles.titled}`}>
                            <TitleIcon path={BOOK} />
                            Reads about
                          </h2>
                        </div>
                        <ul className={styles.chips}>
                          {stats.topics.map((topic) => (
                            <li key={topic.name} className={styles.chip}>
                              {topicLabel(topic.name)}
                              <span>{topic.count}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    {stats.milestones.length > 0 ? (
                      <div className={`${styles.hideWide} ${styles.noPrint}`}>
                        {milestonesCard("milestones")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : page.building ? (
              <Overview stats={null} building={page.building} />
            ) : null}
          </div>

          {/* Daily notes stay on the page: the PDF is a one-page summary. */}
          <div className={`${styles.takeawaysBlock} ${styles.noPrint}`}>
            <div className={styles.takeawaysHead}>
              <h2 className={styles.takeawaysTitle}>What I learned</h2>
            </div>

            {page.days.length === 0 ? (
              <p className={styles.empty}>Nothing here yet. Check back soon.</p>
            ) : (
              <DayFeed
                handle={page.handle}
                initialDays={page.days}
                initialCursor={page.nextDaysCursor}
              />
            )}
          </div>

          <footer className={`${styles.footer} ${styles.noPrint}`}>
            {page.showFooter ? (
              <>
                <a className={styles.cta} href="https://aeyhey.com">
                  Create your reading profile
                </a>
                <span className={styles.madeWith}>Made with Aeyhey</span>
              </>
            ) : null}
          </footer>
        </main>
      </div>
    </div>
  );
}
