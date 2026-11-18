"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The "What I learned" feed: the page arrives with the newest seven days, and each press
// of the button fetches the next seven from /api/u/:handle/days. Nothing older is sent or
// read until someone asks for it.

import { useState } from "react";
import styles from "./profile.module.css";

export interface FeedDay {
  day: string;
  learned: { text: string; title: string | null; url: string; site: string | null }[];
  built: { done: string[]; progress: string[]; learned: string[] } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BOOK = "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z";
const TERMINAL = "M4 17l6-6-6-6M12 19h8";

function Icon({ path }: { path: string }) {
  return (
    <svg
      width={13}
      height={13}
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

/** "Monday, 16 Nov" for a YYYY-MM-DD day. */
function longDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "2 learnings, 3 updates" for a day's header. */
function daySummary(day: FeedDay): string {
  const updates = day.built
    ? day.built.done.length + day.built.progress.length + day.built.learned.length
    : 0;
  return [
    day.learned.length > 0
      ? `${day.learned.length} ${day.learned.length === 1 ? "learning" : "learnings"}`
      : null,
    updates > 0 ? `${updates} ${updates === 1 ? "update" : "updates"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** One part of a day's standup, such as Done, when it has anything in it. */
function Standup({
  label,
  notes,
  tone,
}: {
  label: string;
  notes: string[];
  tone: string | undefined;
}) {
  if (notes.length === 0) return null;
  return (
    <div className={`${styles.standup} ${tone}`}>
      <span className={styles.standupLabel}>{label}</span>
      <ul className={styles.notes}>
        {notes.map((note) => (
          <li key={note} className={styles.noteItem}>
            <span className={styles.noteDot} aria-hidden="true" />
            <p className={styles.note}>{note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayCard({ day }: { day: FeedDay }) {
  const date = new Date(`${day.day}T00:00:00Z`);
  return (
    <li className={styles.feedRow}>
      <div className={styles.feedDate} aria-hidden="true">
        <span className={styles.feedDay}>{date.getUTCDate()}</span>
        <span className={styles.feedMonth}>{MONTHS[date.getUTCMonth()]}</span>
        <span className={styles.feedWeekday}>{WEEKDAYS[date.getUTCDay()]!.slice(0, 3)}</span>
      </div>
      <span className={styles.feedDot} aria-hidden="true" />
      <article className={`${styles.card} ${styles.dayCard}`}>
        <header className={styles.dayHead}>
          <h3 className={styles.dayTitle}>
            <time dateTime={day.day}>{longDay(day.day)}</time>
          </h3>
          <span className={styles.daySummary}>{daySummary(day)}</span>
        </header>
        <div className={day.learned.length > 0 && day.built ? styles.daySplit : styles.dayOne}>
          {day.learned.length > 0 ? (
            <section aria-label="Learned" className={styles.toneLearn}>
              <h4 className={styles.dayLabel}>
                <span className={styles.dayLabelIcon}>
                  <Icon path={BOOK} />
                </span>
                Learned
              </h4>
              <ul className={styles.notes}>
                {day.learned.map((note) => (
                  <li key={note.url} className={styles.noteItem}>
                    <span className={styles.noteDot} aria-hidden="true" />
                    <div>
                      <p className={styles.note}>{note.text}</p>
                      <a
                        className={styles.noteSource}
                        href={note.url}
                        rel="noopener noreferrer nofollow ugc"
                        target="_blank"
                      >
                        <span className={styles.noteSite} aria-hidden="true">
                          {(note.site ?? note.title ?? "?").charAt(0).toUpperCase()}
                        </span>
                        <span className={styles.noteTitle}>{note.title ?? note.url}</span>
                        {note.site ? <span className={styles.noteHost}>{note.site}</span> : null}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {day.built ? (
            <section aria-label="Built" className={styles.toneBuild}>
              <h4 className={styles.dayLabel}>
                <span className={styles.dayLabelIcon}>
                  <Icon path={TERMINAL} />
                </span>
                Built with coding agents
              </h4>
              <Standup label="Done" notes={day.built.done} tone={styles.toneDone} />
              <Standup label="In progress" notes={day.built.progress} tone={styles.toneGoing} />
              <Standup label="Learned" notes={day.built.learned} tone={styles.toneLesson} />
            </section>
          ) : null}
        </div>
      </article>
    </li>
  );
}

export function DayFeed({
  handle,
  initialDays,
  initialCursor,
  moreFrom,
}: {
  handle: string;
  initialDays: FeedDay[];
  initialCursor: string | null;
  /** Where older days come from: the public feed, or the owner's own for Your page. */
  moreFrom?: string;
}) {
  const [days, setDays] = useState(initialDays);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(
        `${moreFrom ?? `/api/u/${encodeURIComponent(handle)}/days`}?before=${encodeURIComponent(cursor)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { days: FeedDay[]; nextCursor: string | null };
      setDays((current) => [
        ...current,
        ...page.days.filter((d) => !current.some((c) => c.day === d.day)),
      ]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ol className={styles.feed}>
        {days.map((day) => (
          <DayCard key={day.day} day={day} />
        ))}
      </ol>
      {cursor ? (
        <button type="button" className={styles.feedMore} onClick={loadMore} disabled={loading}>
          {loading ? "Loading" : failed ? "Could not load. Try again" : "Show earlier days"}
        </button>
      ) : null}
    </>
  );
}
