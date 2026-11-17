"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The journal (PRD 29): how much you built with coding agents, and the few highlights
// each day leaves. Drafts wait here until you keep, reword or drop them; nothing reaches
// your public page without that.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { pluralize } from "../lib/format";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  Input,
  Notice,
  Page,
  PageHeader,
  StatTile,
} from "./ui";

interface AgentDay {
  day: string;
  sessions: number;
  activeMinutes: number;
  agentMinutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tools: Record<string, { sessions: number; tokens: number }>;
  details?: Details;
}

/** The parts of a day's details this page shows. The rest is kept for later features. */
interface Details {
  models?: Record<string, { input: number; output: number; cache: number; messages: number }>;
  prompts?: number;
  turns?: number;
  toolCalls?: Record<string, number>;
  languages?: Record<string, number>;
  skills?: Record<string, number>;
  mcpServers?: Record<string, number>;
  linesAdded?: number;
  linesRemoved?: number;
}

function addUp(list: AgentDay[]) {
  const sumMap = (pick: (d: Details) => Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const d of list) {
      for (const [key, value] of Object.entries(pick(d.details ?? {}) ?? {})) {
        out[key] = (out[key] ?? 0) + value;
      }
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  };
  const sum = (pick: (d: Details) => number | undefined) =>
    list.reduce((total, d) => total + (pick(d.details ?? {}) ?? 0), 0);
  const models: Record<string, number> = {};
  for (const d of list) {
    for (const [name, u] of Object.entries(d.details?.models ?? {})) {
      models[name] = (models[name] ?? 0) + u.input + u.output + u.cache;
    }
  }
  return {
    models: Object.entries(models).sort((a, b) => b[1] - a[1]),
    prompts: sum((d) => d.prompts),
    turns: sum((d) => d.turns),
    linesAdded: sum((d) => d.linesAdded),
    linesRemoved: sum((d) => d.linesRemoved),
    tools: sumMap((d) => d.toolCalls),
    languages: sumMap((d) => d.languages),
    extras: [...sumMap((d) => d.skills), ...sumMap((d) => d.mcpServers)],
  };
}

/** mcp__Claude_Browser__navigate reads as Claude Browser: navigate. */
function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? `${mcp[1]!.replace(/_/g, " ")}: ${mcp[2]!.replace(/_/g, " ")}` : name;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

interface Highlight {
  id: string;
  day: string;
  text: string;
  kind: "shipped" | "progress" | "learned" | "pinned";
  status: "draft" | "kept" | "dropped";
  repo: string | null;
  hiddenFromPage: boolean;
}

/** What was read and reviewed on a day. */
export interface ReadingDay {
  day: string;
  read: {
    id: string;
    url: string;
    title: string | null;
    site: string | null;
    readMinutes: number | null;
    takeaway: string | null;
  }[];
  reviews: number;
}

const KIND_LABELS: Record<Highlight["kind"], string> = {
  shipped: "Shipped",
  progress: "In progress",
  learned: "Learned",
  pinned: "Pinned",
};

const TOOL_LABELS: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

export function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function tokensLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function dayLabel(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - date.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  // A fixed locale, so the server's render and the browser's agree.
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

export function JournalView({
  today,
  days,
  highlights: initial,
  reading,
  daysBuilding,
  activity,
}: {
  today: string;
  days: AgentDay[];
  highlights: Highlight[];
  reading: ReadingDay[];
  daysBuilding: number;
  /** One activity per day: reads, reviews and building together, oldest first. */
  activity: { start: string; counts: number[] };
}) {
  const [highlights, setHighlights] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const byDay = new Map(days.map((d) => [d.day, d]));
  const weekAgo = shiftDay(today, -6);
  const lastWeek = days.filter((d) => d.day >= weekAgo);
  const sum = (list: AgentDay[], pick: (d: AgentDay) => number) =>
    list.reduce((total, d) => total + pick(d), 0);
  const todayRow = byDay.get(today);
  const tokensOf = (d: AgentDay) => d.inputTokens + d.outputTokens + d.cacheTokens;

  const tools = new Map<string, { sessions: number; tokens: number }>();
  for (const d of lastWeek) {
    for (const [name, value] of Object.entries(d.tools)) {
      const current = tools.get(name) ?? { sessions: 0, tokens: 0 };
      tools.set(name, {
        sessions: current.sessions + value.sessions,
        tokens: current.tokens + value.tokens,
      });
    }
  }

  async function patch(
    id: string,
    body: { status?: Highlight["status"]; text?: string; hiddenFromPage?: boolean },
  ) {
    setBusy(true);
    setError(null);
    try {
      const { highlight } = await apiClient.patch<{ highlight: Highlight }>(
        `/api/highlights/${id}`,
        body,
      );
      setHighlights((list) =>
        highlight.status === "dropped"
          ? list.filter((h) => h.id !== id)
          : list.map((h) => (h.id === id ? highlight : h)),
      );
      setEditing(null);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function draftToday() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await apiClient.post<{ drafted: number; highlights: Highlight[] }>(
        "/api/agent/digest",
        { day: today },
      );
      setHighlights((list) => [...result.highlights, ...list.filter((h) => h.day !== today)]);
      setNote(
        result.drafted === 0
          ? "Nothing from today stood out yet. Quick questions and sessions without changes are left out."
          : `Drafted ${result.drafted} for today. Keep the ones that matter.`,
      );
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // One entry per day with anything in it: built, read or reviewed.
  const grouped = new Map<string, Highlight[]>();
  for (const h of highlights) grouped.set(h.day, [...(grouped.get(h.day) ?? []), h]);
  const readingByDay = new Map(reading.map((r) => [r.day, r]));
  const entryDays = [
    ...new Set([
      ...grouped.keys(),
      ...reading.map((r) => r.day),
      ...days.filter((d) => d.sessions > 0).map((d) => d.day),
    ]),
  ].sort((a, b) => (a < b ? 1 : -1));
  const drafts = highlights.filter((h) => h.status === "draft").length;
  const noAgent = days.length === 0 && highlights.length === 0;

  return (
    <Page>
      <PageHeader
        title="Journal"
        subtitle="Each day as you lived it: what you read, what you reviewed, and what you built with coding agents. Only what you choose goes on your page."
        {...(drafts > 0 ? { eyebrow: `${drafts} to review` } : {})}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {note ? <Notice tone="info">{note}</Notice> : null}

      {noAgent ? (
        <Notice tone="info">
          Connect Claude Code or another coding agent to add what you build to each day.{" "}
          <a href="/settings?tab=agents" className="text-primary font-semibold underline">
            Connect an agent
          </a>
        </Notice>
      ) : null}
      {entryDays.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Read a link, review a card or finish a coding session, and the day shows up here."
        />
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <CardTitle hint="One grid for all of it: a day you read, reviewed or built is an active day. Darker means more.">
              Activity
            </CardTitle>
            <ActivityGrid start={activity.start} counts={activity.counts} />
            {tools.size > 0 ? (
              <p className="text-muted-foreground text-xs">
                Building, last 7 days:{" "}
                {[...tools.entries()]
                  .map(
                    ([name, value]) =>
                      `${TOOL_LABELS[name] ?? name}, ${pluralize(value.sessions, "session")}, ${tokensLabel(value.tokens)} tokens`,
                  )
                  .join("; ")}
              </p>
            ) : null}
          </Card>

          {!noAgent ? (
            <>
              <section
                aria-label="Totals"
                className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
              >
                <StatTile
                  label="Today"
                  value={hoursLabel(todayRow?.activeMinutes ?? 0)}
                  detail={pluralize(todayRow?.sessions ?? 0, "session")}
                />
                <StatTile
                  label="Last 7 days"
                  value={hoursLabel(sum(lastWeek, (d) => d.activeMinutes))}
                  detail={`${hoursLabel(sum(lastWeek, (d) => d.agentMinutes))} of agent time`}
                />
                <StatTile
                  label="Tokens, 7 days"
                  value={tokensLabel(sum(lastWeek, tokensOf))}
                  detail={pluralize(
                    sum(lastWeek, (d) => d.sessions),
                    "session",
                  )}
                />
                <StatTile
                  label="Days building"
                  value={daysBuilding}
                  detail="Days with a kept highlight"
                />
              </section>

              <HowYouBuilt week={addUp(lastWeek)} />
            </>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Days</h2>
            {!noAgent ? (
              <Button tone="secondary" disabled={busy} onClick={draftToday}>
                Draft today&apos;s highlights
              </Button>
            ) : null}
          </div>

          {entryDays.map((day) => {
            const built = byDay.get(day);
            const readDay = readingByDay.get(day);
            const summary = [
              built ? `${hoursLabel(built.activeMinutes)} building` : null,
              readDay && readDay.read.length > 0 ? `${readDay.read.length} read` : null,
              readDay && readDay.reviews > 0 ? `${readDay.reviews} reviewed` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <Card key={day} className="flex flex-col gap-4">
                <CardTitle hint={summary}>{dayLabel(day, today)}</CardTitle>
                {(grouped.get(day) ?? []).length > 0 ? (
                  <section className="flex flex-col gap-2" aria-label="Built">
                    <h3 className="text-subtle-foreground text-xs font-semibold">Built</h3>
                    <ul className="flex flex-col gap-2.5">
                      {(grouped.get(day) ?? []).map((h) => (
                        <li
                          key={h.id}
                          className="border-border flex flex-col gap-2 border-t pt-2.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {editing?.id === h.id ? (
                              <Input
                                aria-label="Highlight"
                                value={editing.text}
                                maxLength={280}
                                onChange={(event) =>
                                  setEditing({ id: h.id, text: event.target.value })
                                }
                              />
                            ) : (
                              <p
                                className={
                                  h.status === "draft" ? "text-muted-foreground" : "font-medium"
                                }
                              >
                                {h.text}
                              </p>
                            )}
                            <p className="text-subtle-foreground text-xs">
                              {KIND_LABELS[h.kind]}
                              {h.repo ? `, ${h.repo}` : ""}
                              {h.status === "draft" ? ", draft" : ""}
                              {h.status === "kept" && h.hiddenFromPage
                                ? ", hidden from your page"
                                : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            {editing?.id === h.id ? (
                              <>
                                <Button
                                  size="sm"
                                  tone="primary"
                                  disabled={busy || editing.text.trim() === ""}
                                  onClick={() =>
                                    patch(h.id, { text: editing.text.trim(), status: "kept" })
                                  }
                                >
                                  Save
                                </Button>
                                <Button size="sm" tone="ghost" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                {h.status === "draft" ? (
                                  <Button
                                    size="sm"
                                    tone="primary"
                                    disabled={busy}
                                    onClick={() => patch(h.id, { status: "kept" })}
                                  >
                                    Keep
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  tone="ghost"
                                  disabled={busy}
                                  onClick={() => setEditing({ id: h.id, text: h.text })}
                                >
                                  Edit
                                </Button>
                                {h.status === "kept" ? (
                                  <Button
                                    size="sm"
                                    tone="ghost"
                                    disabled={busy}
                                    onClick={() =>
                                      patch(h.id, { hiddenFromPage: !h.hiddenFromPage })
                                    }
                                  >
                                    {h.hiddenFromPage ? "Show on page" : "Hide from page"}
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  tone="ghost"
                                  disabled={busy}
                                  onClick={() => patch(h.id, { status: "dropped" })}
                                >
                                  {h.status === "draft" ? "Drop" : "Remove"}
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {readDay && readDay.read.length > 0 ? (
                  <section className="flex flex-col gap-2" aria-label="Read">
                    <h3 className="text-subtle-foreground text-xs font-semibold">Read</h3>
                    <ul className="flex flex-col gap-2">
                      {readDay.read.map((link) => (
                        <li key={link.id} className="flex min-w-0 flex-col gap-0.5">
                          <a
                            href={`/links/${link.id}`}
                            className="truncate text-sm font-medium hover:underline"
                          >
                            {link.title ?? link.url}
                          </a>
                          <span className="text-subtle-foreground text-xs">
                            {link.site ?? ""}
                            {link.readMinutes ? `, ${link.readMinutes} min` : ""}
                            {link.takeaway ? ", on your page" : ""}
                          </span>
                          {link.takeaway ? (
                            <p className="text-muted-foreground text-sm">{link.takeaway}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}

/** One square per day, weeks as columns, darker for a busier day. Ends today. */
function ActivityGrid({ start, counts }: { start: string; counts: number[] }) {
  // Pad the front so each column is a Monday to Sunday week.
  const lead = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: lead }, (_, i) => ({ key: `pad-${i}`, count: -1, day: "" })),
    ...counts.map((count, i) => ({ key: shiftDay(start, i), count, day: shiftDay(start, i) })),
  ];
  const level = (count: number) =>
    count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
  const tones = ["bg-sunken", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];
  const active = counts.filter((count) => count > 0).length;
  return (
    <div className="overflow-x-auto">
      <div
        className="grid grid-flow-col grid-rows-7 gap-[3px]"
        style={{ gridAutoColumns: "minmax(10px, 1fr)" }}
        role="img"
        aria-label={`Active on ${active} of the last ${counts.length} days`}
      >
        {cells.map((cell) => (
          <span
            key={cell.key}
            title={cell.count < 0 ? undefined : cell.day}
            className={`aspect-square rounded-[3px] ${cell.count < 0 ? "opacity-0" : tones[level(cell.count)]}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Last 7 days: models, prompts, lines, tools and languages, from the sessions' details. */
function HowYouBuilt({ week }: { week: ReturnType<typeof addUp> }) {
  const modelTotal = week.models.reduce((total, [, tokens]) => total + tokens, 0);
  const rows: { label: string; value: string }[] = [];
  if (week.models.length > 0) {
    rows.push({
      label: "Models",
      value: week.models
        .slice(0, 3)
        .map(([name, tokens]) => `${name} ${percent(tokens, modelTotal)}`)
        .join(", "),
    });
  }
  if (week.prompts > 0) {
    rows.push({
      label: "Prompts",
      value: `${week.prompts.toLocaleString()} prompts, ${week.turns.toLocaleString()} agent turns`,
    });
  }
  if (week.linesAdded + week.linesRemoved > 0) {
    rows.push({
      label: "Lines",
      value: `${week.linesAdded.toLocaleString()} added, ${week.linesRemoved.toLocaleString()} removed`,
    });
  }
  if (week.tools.length > 0) {
    rows.push({
      label: "Most used tools",
      value: week.tools
        .slice(0, 5)
        .map(([name, count]) => `${toolLabel(name)} (${count.toLocaleString()})`)
        .join(", "),
    });
  }
  if (week.languages.length > 0) {
    rows.push({
      label: "Languages",
      value: week.languages
        .slice(0, 6)
        .map(([ext]) => ext)
        .join(", "),
    });
  }
  if (week.extras.length > 0) {
    rows.push({
      label: "Skills and servers",
      value: week.extras
        .slice(0, 5)
        .map(([name]) => name.replace(/_/g, " "))
        .join(", "),
    });
  }
  if (rows.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle hint="Last 7 days, from your sessions. Counts and names only.">
        How you built
      </CardTitle>
      <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
