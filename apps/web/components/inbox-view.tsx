"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The inbox, as the phone app has it: a stack of clippings.
//
// Each link is a row with its title in the display face, grouped by when it was saved.
// The filters are words with an underline, not chips, and a row only names its state
// when the filter does not already say it. The little glass beside each row drains as a
// link is put off, so what is about to expire shows without reading.
//
// A wide screen adds what a mouse and the room allow: a reading pane beside the list, so
// a pile can be gone through without a page load per link; Read and Drop on each row
// when the pointer is over it, where the phone has swipes; and a checkbox for acting on
// many links at once.

import { useState } from "react";
import { Check, ChevronDown, ExternalLink, Search, Trash2, Undo2 } from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar";
import { apiClient, ApiRequestError } from "../lib/client";
import { hostOf } from "../lib/format";
import { hueFor, strong, type Hue } from "../lib/hue";
import { LifeMark } from "./drawings";
import { cx } from "./ui";

interface InboxItem {
  id: string;
  url: string;
  title: string | null;
  siteName: string | null;
  status: string;
  contentType?: string | null;
  summaryLines: [string, string, string] | null;
  whySaved: string | null;
  readMinutes: number | null;
  savedAt: string;
  aiStatus: string;
  extractStatus: string;
  tags: string[];
  due: string | null;
  lifeLeft?: number | null;
}

interface Counts {
  unread: number;
  snoozed: number;
  read: number;
  dropped: number;
  expiring: number;
  expired: number;
}

const MAIN_TABS: { status: string; label: string }[] = [
  { status: "unread", label: "Unread" },
  { status: "snoozed", label: "Later" },
  { status: "expiring", label: "Last chance" },
];

const MORE_TABS: { status: string; label: string }[] = [
  { status: "read", label: "Read" },
  { status: "dropped", label: "Dropped" },
  { status: "expired", label: "Expired" },
  { status: "all", label: "All links" },
];

const STATE_LABEL: Record<string, { label: string; hue: Hue | null }> = {
  unread: { label: "Unread", hue: "blue" },
  snoozed: { label: "Later", hue: "violet" },
  read: { label: "Read", hue: "green" },
  dropped: { label: "Dropped", hue: null },
  expiring: { label: "Last chance", hue: "amber" },
  expired: { label: "Expired", hue: "red" },
};

const EMPTY: Record<string, { title: string; body: string }> = {
  unread: {
    title: "You are all caught up",
    body: "Nothing is waiting to be read. Links you save next land here.",
  },
  snoozed: {
    title: "Nothing set aside",
    body: "Links you push to later wait here until their day comes.",
  },
  expiring: {
    title: "Nothing about to expire",
    body: "Links close to expiring show up here, so you get one last look.",
  },
  read: { title: "Nothing read yet", body: "Links you open or mark as read are kept here." },
  dropped: {
    title: "Nothing dropped",
    body: "Links you drop are kept here, in case you want one back.",
  },
  expired: {
    title: "Nothing has expired",
    body: "Links you don't get to in time end up here, and you can bring any of them back.",
  },
  all: { title: "Nothing saved yet", body: "Links you save land here." },
};

type Action = "mark_read" | "drop" | "restore";

/** "Today", "Yesterday", "This week", then the month, as the phone groups saved links. */
function groupOf(iso: string, now: Date): string {
  const saved = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((startOfToday - saved.getTime()) / 86_400_000) + 1;
  if (saved.getTime() >= startOfToday) return "Today";
  if (days <= 1) return "Yesterday";
  if (days < 7) return "This week";
  const month = saved.toLocaleDateString("en-GB", { month: "long" });
  return saved.getFullYear() === now.getFullYear() ? month : `${month} ${saved.getFullYear()}`;
}

function relativeDay(iso: string, now: Date): string {
  const days = Math.round((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Two tags in their own colours; a second one that lands on the same hue moves on. */
function tagHues(tags: string[]): Hue[] {
  const order: Hue[] = ["orange", "blue", "violet", "green", "pink", "teal"];
  const first = tags[0] ? hueFor(tags[0]) : "blue";
  let second = tags[1] ? hueFor(tags[1]) : "blue";
  if (tags[1] && second === first)
    second = order[(order.indexOf(first) + 1) % order.length] ?? "blue";
  return [first, second];
}

export function InboxView({
  initialItems,
  nextCursor,
  counts,
  tags,
  activeStatus,
  activeTag,
  query,
}: {
  initialItems: InboxItem[];
  nextCursor: string | null;
  counts: Counts;
  tags: string[];
  activeStatus: string;
  activeTag: string | null;
  query: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(nextCursor);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(query);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: string[]; error?: boolean } | null>(
    null,
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const now = new Date();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  function linkTo(next: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const merged = { status: activeStatus, tag: activeTag, q: search || null, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === "status" && value === "unread")) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  /** Read, drop or restore, then take the rows out of a filter they no longer fit. */
  async function act(ids: string[], action: Action): Promise<void> {
    if (ids.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await apiClient.post("/api/links/bulk", { ids, action });
      const nextStatus = action === "drop" ? "dropped" : action === "restore" ? "unread" : "read";
      const leaves = activeStatus !== "all" && activeStatus !== nextStatus;
      const removed = new Set(ids);
      setItems((current) =>
        leaves
          ? current.filter((item) => !removed.has(item.id))
          : current.map((item) => (removed.has(item.id) ? { ...item, status: nextStatus } : item)),
      );
      setSelected(new Set());
      if (action !== "restore") {
        const what = ids.length === 1 ? "" : `${ids.length} links `;
        setNotice({
          text: action === "drop" ? `${what}Dropped.` : `${what}Marked as read.`,
          undo: ids,
        });
      } else {
        setNotice({ text: "Back in your queue." });
      }
    } catch (thrown) {
      setNotice({
        text:
          thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function undo(ids: string[]): Promise<void> {
    setBusy(true);
    try {
      await apiClient.post("/api/links/bulk", { ids, action: "restore" });
      window.location.reload();
    } catch {
      setNotice({ text: "Could not undo that.", error: true });
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ cursor, limit: "50" });
      if (activeStatus !== "all") params.set("status", activeStatus);
      if (activeTag) params.set("tag", activeTag);
      if (search) params.set("q", search);
      const page = await apiClient.get<{ items: InboxItem[]; nextCursor: string | null }>(
        `/api/links?${params}`,
      );
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setBusy(false);
    }
  }

  const preview = items.find((item) => item.id === previewId) ?? items[0] ?? null;
  const moreTab = MORE_TABS.find((tab) => tab.status === activeStatus);

  // Rows grouped under their day headings, in the order they came.
  const groups: { label: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const label = groupOf(item.savedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  const empty = EMPTY[activeStatus] ?? EMPTY["unread"]!;

  return (
    <main className="mx-auto w-full max-w-6xl pb-16 lg:px-8 lg:pt-4">
      <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]">
        <div className="min-w-0">
          <form action="/inbox" className="px-4 pb-0.5 pt-1 lg:px-0">
            {activeStatus !== "unread" ? (
              <input type="hidden" name="status" value={activeStatus} />
            ) : null}
            {activeTag ? <input type="hidden" name="tag" value={activeTag} /> : null}
            <label className="inbox-search flex items-center rounded-full">
              <span className="text-muted-foreground grid w-11 shrink-0 place-items-center">
                <Search size={18} aria-hidden="true" />
              </span>
              <input
                type="search"
                name="q"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your links"
                aria-label="Search your links"
                className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-3 pr-4 text-[15px] outline-none"
              />
            </label>
          </form>

          <nav
            aria-label="Filter your links"
            className="border-border flex h-11 items-stretch border-b-[0.5px] px-3 lg:px-0"
          >
            <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
              {MAIN_TABS.map((tab) => (
                <FilterTab
                  key={tab.status}
                  href={linkTo({ status: tab.status })}
                  selected={activeStatus === tab.status}
                  label={tab.label}
                  count={counts[tab.status as keyof Counts]}
                />
              ))}
            </div>
            <Menu>
              <MenuTrigger
                aria-label="More filters"
                className={cx(
                  "relative flex shrink-0 items-center gap-1 self-stretch px-2.5 text-[14.5px]",
                  moreTab ? "text-foreground font-semibold" : "text-muted-foreground",
                )}
              >
                {moreTab?.label ?? "More"}
                <ChevronDown size={15} aria-hidden="true" />
                {moreTab ? (
                  <span className="bg-primary absolute inset-x-2.5 bottom-0 h-0.5 rounded-sm" />
                ) : null}
              </MenuTrigger>
              <MenuContent align="end" sideOffset={4} className="later-menu min-w-44">
                {MORE_TABS.map((tab) => (
                  <MenuItem
                    key={tab.status}
                    onSelect={() => {
                      window.location.href = linkTo({ status: tab.status });
                    }}
                  >
                    <span className="flex-1">{tab.label}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {tab.status === "all" ? total : counts[tab.status as keyof Counts]}
                    </span>
                    {activeStatus === tab.status ? (
                      <Check size={16} aria-hidden="true" className="text-primary" />
                    ) : null}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </nav>

          {tags.length > 0 ? (
            <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[13px] lg:flex">
              <span className="text-muted-foreground">Tags</span>
              {tags.slice(0, 12).map((tag) => (
                <a
                  key={tag}
                  href={linkTo({ tag: activeTag === tag ? null : tag })}
                  className={cx(
                    "font-semibold hover:underline",
                    activeTag === tag &&
                      "bg-primary text-primary-foreground rounded-full px-2 py-0.5 hover:no-underline",
                  )}
                  style={activeTag === tag ? undefined : { color: strong(hueFor(tag)) }}
                >
                  #{tag}
                </a>
              ))}
            </div>
          ) : null}

          {notice ? (
            <div
              role="status"
              className={cx(
                "inbox-notice mx-4 mt-3 flex items-center gap-2 rounded-[18px] py-1.5 pl-4 pr-1.5 text-sm font-medium lg:mx-0",
                notice.error && "text-danger",
              )}
            >
              <span className="flex-1">{notice.text}</span>
              {notice.undo ? (
                <SdkButton
                  disabled={busy}
                  onClick={() => void undo(notice.undo ?? [])}
                  className="text-primary flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold"
                >
                  <Undo2 size={15} aria-hidden="true" />
                  Undo
                </SdkButton>
              ) : null}
            </div>
          ) : null}

          {selected.size > 0 ? (
            <Toolbar
              aria-label="Actions for the selected links"
              className="bg-surface border-border sticky top-16 z-20 mt-3 hidden items-center gap-1 rounded-full border py-1 pl-4 pr-1 lg:flex"
            >
              <span className="flex-1 text-sm font-semibold">{selected.size} selected</span>
              <ToolbarButton
                className="inbox-tool"
                disabled={busy}
                onClick={() => void act([...selected], "mark_read")}
              >
                <Check size={15} aria-hidden="true" />
                Read
              </ToolbarButton>
              <ToolbarButton
                className="inbox-tool"
                disabled={busy}
                onClick={() => void act([...selected], "drop")}
              >
                <Trash2 size={15} aria-hidden="true" />
                Drop
              </ToolbarButton>
              <ToolbarButton
                className="inbox-tool"
                disabled={busy}
                onClick={() => void act([...selected], "restore")}
              >
                <Undo2 size={15} aria-hidden="true" />
                Back to unread
              </ToolbarButton>
              <ToolbarButton className="inbox-tool" onClick={() => setSelected(new Set())}>
                Clear
              </ToolbarButton>
            </Toolbar>
          ) : null}

          {items.length === 0 ? (
            <div className="px-[22px] pt-9 lg:px-0">
              <p className="font-display text-[22px] font-[520] leading-[1.2] tracking-[-0.01em]">
                {search ? `No links match "${search}"` : empty.title}
              </p>
              <p className="text-muted-foreground mt-2 max-w-md text-[15px] leading-[1.45]">
                {search ? "Try other words, or look through all your links." : empty.body}
              </p>
              {search && activeStatus !== "all" ? (
                <a
                  href={`/inbox?status=all&q=${encodeURIComponent(search)}`}
                  className="text-primary mt-3.5 inline-block text-[15px] font-semibold"
                >
                  Search all links
                </a>
              ) : activeStatus === "unread" && !search ? (
                <a
                  href="/?say=https%3A%2F%2F"
                  className="text-primary mt-3.5 inline-block text-[15px] font-semibold"
                >
                  Save a link
                </a>
              ) : null}
            </div>
          ) : (
            <div className="pt-1">
              {groups.map((group, groupIndex) => (
                <section key={`${group.label}-${groupIndex}`} aria-label={group.label}>
                  <h2
                    className={cx(
                      "font-display px-[22px] pb-0.5 text-[17px] font-[640] tracking-[-0.006em] lg:px-0",
                      groupIndex === 0 ? "pt-[18px]" : "pt-4",
                    )}
                  >
                    {group.label}
                  </h2>
                  <ul>
                    {group.items.map((item, index) => (
                      <InboxRow
                        key={item.id}
                        item={item}
                        first={index === 0}
                        now={now}
                        showDay={group.label !== "Today" && group.label !== "Yesterday"}
                        activeStatus={activeStatus}
                        selected={selected.has(item.id)}
                        previewed={preview?.id === item.id}
                        busy={busy}
                        onToggle={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        onPreview={() => setPreviewId(item.id)}
                        onAct={(action) => void act([item.id], action)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {cursor ? (
                <div className="px-[22px] pt-6 lg:px-0">
                  <SdkButton
                    disabled={busy}
                    onClick={() => void loadMore()}
                    className="quiet-pill w-full"
                  >
                    {busy ? "Loading" : "Show more"}
                  </SdkButton>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {preview ? (
          <ReadingPane
            item={preview}
            busy={busy}
            onAct={(action) => void act([preview.id], action)}
          />
        ) : null}
      </div>
    </main>
  );
}

function FilterTab({
  href,
  selected,
  label,
  count,
}: {
  href: string;
  selected: boolean;
  label: string;
  count?: number;
}) {
  return (
    <a
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cx(
        "relative flex shrink-0 items-center gap-1.5 px-2.5 text-[14.5px] transition-colors",
        selected ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count ? (
        <span className="text-subtle-foreground hidden text-xs font-normal tabular-nums lg:inline">
          {count}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={cx(
          "absolute inset-x-2.5 bottom-0 h-0.5 rounded-sm",
          selected ? "bg-primary" : "bg-transparent",
        )}
      />
    </a>
  );
}

/** True when the reading pane is on screen, which is the xl breakpoint and up. */
function paneIsVisible(): boolean {
  return window.matchMedia("(min-width: 1280px)").matches;
}

function InboxRow({
  item,
  first,
  now,
  showDay,
  activeStatus,
  selected,
  previewed,
  busy,
  onToggle,
  onPreview,
  onAct,
}: {
  item: InboxItem;
  first: boolean;
  now: Date;
  showDay: boolean;
  activeStatus: string;
  selected: boolean;
  previewed: boolean;
  busy: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onAct: (action: Action) => void;
}) {
  const state = STATE_LABEL[item.status];
  const showState = item.status !== activeStatus && item.status !== "unread" && state;
  const [firstHue = "blue", secondHue = "blue"] = tagHues(item.tags);
  const processing = item.aiStatus === "pending" || item.extractStatus === "pending";

  return (
    <li
      className={cx(
        "group relative flex gap-3 px-[22px] pb-[17px] pt-4 transition-colors lg:-mx-3 lg:rounded-2xl lg:px-3",
        item.status === "expiring" && "border-l-[3px] pl-[19px] lg:pl-3",
        selected
          ? "lg:bg-primary-soft/60"
          : previewed
            ? "xl:bg-[color-mix(in_srgb,var(--color-quiet)_80%,transparent)]"
            : "lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_55%,transparent)]",
      )}
      style={item.status === "expiring" ? { borderLeftColor: strong("amber") } : undefined}
    >
      {first ? null : (
        <span
          aria-hidden="true"
          className="border-border absolute left-16 right-[22px] top-0 border-t-[0.5px] lg:left-[54px] lg:right-3"
        />
      )}

      <span className="relative mt-0.5 shrink-0">
        <span className={cx("lg:group-hover:invisible", selected && "lg:invisible")}>
          <LifeMark url={item.url} siteName={item.siteName} lifeLeft={item.lifeLeft ?? null} />
        </span>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.title ?? item.url}`}
          className={cx(
            "inbox-check absolute inset-0 m-auto hidden lg:grid",
            selected ? "visible" : "invisible group-hover:visible",
          )}
        >
          <CheckboxIndicator>
            <Check size={14} aria-hidden="true" />
          </CheckboxIndicator>
        </Checkbox>
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-muted-foreground flex items-center text-[12.5px] leading-[1.35]">
          <span className="truncate">
            {item.siteName ?? hostOf(item.url)}
            {item.readMinutes ? ` · ${item.readMinutes} min` : ""}
            {showDay ? ` · ${relativeDay(item.savedAt, now)}` : ""}
            {showState ? (
              <>
                {" · "}
                <span
                  className="font-medium"
                  style={{ color: state.hue ? strong(state.hue) : undefined }}
                >
                  {state.label.toLowerCase()}
                </span>
              </>
            ) : null}
          </span>
          {processing ? (
            <span className="ml-2 flex shrink-0 items-center gap-1.5">
              <span className="border-muted-foreground size-2.5 animate-spin rounded-full border-[1.4px] border-t-transparent" />
              Summarising
            </span>
          ) : null}
        </p>
        <a
          href={`/links/${item.id}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || !paneIsVisible()) return;
            event.preventDefault();
            onPreview();
          }}
          aria-current={previewed ? "true" : undefined}
          className="font-display mt-[5px] line-clamp-2 text-[19.5px] font-[540] leading-[1.22] tracking-[-0.008em] after:absolute after:inset-0 after:content-['']"
        >
          {item.title ?? item.url}
        </a>
        {item.summaryLines ? (
          <p className="text-muted-foreground mt-[5px] line-clamp-2 text-sm leading-[1.4]">
            {item.summaryLines[0]}
          </p>
        ) : null}
        {item.tags.length > 0 ? (
          <p className="mt-2 flex gap-3 text-[12.5px] font-semibold">
            {item.tags.slice(0, 2).map((tag, index) => (
              <span key={tag} style={{ color: strong(index === 0 ? firstHue : secondHue) }}>
                #{tag}
              </span>
            ))}
            {item.tags.length > 2 ? (
              <span className="text-subtle-foreground">+{item.tags.length - 2}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Where the phone has swipes, a wide screen has these, on the row under the pointer. */}
      <div className="relative z-10 hidden shrink-0 items-start gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 lg:flex">
        {["unread", "snoozed", "expiring"].includes(item.status) ? (
          <SdkButton
            disabled={busy}
            aria-label="Mark as read"
            title="Mark as read"
            onClick={() => onAct("mark_read")}
            className="row-tool"
          >
            <Check size={17} aria-hidden="true" />
          </SdkButton>
        ) : null}
        {item.status === "dropped" || item.status === "expired" || item.status === "read" ? (
          <SdkButton
            disabled={busy}
            aria-label="Back to unread"
            title="Back to unread"
            onClick={() => onAct("restore")}
            className="row-tool"
          >
            <Undo2 size={17} aria-hidden="true" />
          </SdkButton>
        ) : null}
        {item.status !== "dropped" && item.status !== "expired" ? (
          <SdkButton
            disabled={busy}
            aria-label="Drop it"
            title="Drop it"
            onClick={() => onAct("drop")}
            className="row-tool"
          >
            <Trash2 size={17} aria-hidden="true" />
          </SdkButton>
        ) : null}
      </div>
    </li>
  );
}

function ReadingPane({
  item,
  busy,
  onAct,
}: {
  item: InboxItem;
  busy: boolean;
  onAct: (action: Action) => void;
}) {
  const active = ["unread", "snoozed", "expiring"].includes(item.status);
  const state = STATE_LABEL[item.status];
  const summary = item.summaryLines
    ?.map((line) => (/[.!?]$/.test(line.trim()) ? line.trim() : `${line.trim()}.`))
    .join(" ");

  return (
    <section
      aria-label="Selected link"
      className="bg-surface border-border sticky top-20 mt-4 hidden max-h-[calc(100dvh-6.5rem)] flex-col overflow-y-auto rounded-[22px] border p-7 xl:flex"
    >
      <p className="text-muted-foreground text-[13px] leading-[1.4]">
        {item.siteName ?? hostOf(item.url)}
        {item.readMinutes ? ` · ${item.readMinutes} min read` : ""}
        {item.status !== "unread" && state ? (
          <>
            {" · "}
            <span
              className="font-medium"
              style={{ color: state.hue ? strong(state.hue) : undefined }}
            >
              {state.label.toLowerCase()}
            </span>
          </>
        ) : null}
      </p>
      <h2 className="font-display mt-3 text-[29px] font-[560] leading-[1.14] tracking-[-0.014em]">
        {item.title ?? item.url}
      </h2>

      {summary ? (
        <>
          <hr className="border-border my-5 border-t-[0.5px]" />
          <p className="text-[17px] leading-[1.55]">{summary}</p>
        </>
      ) : item.aiStatus === "pending" ? (
        <p className="text-muted-foreground mt-4 text-sm">
          Still reading and summarising this one.
        </p>
      ) : null}

      {item.whySaved ? (
        <div className="mt-[22px] flex gap-3.5">
          <span
            aria-hidden="true"
            className="w-0.5 shrink-0 rounded-sm"
            style={{ background: strong("amber") }}
          />
          <div className="flex flex-col gap-[3px]">
            <span className="text-[12.5px] font-semibold" style={{ color: strong("amber") }}>
              Why you probably saved it
            </span>
            <span className="text-[14.5px] leading-[1.45]">{item.whySaved}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-7 flex items-center gap-2">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={() => {
            if (active) onAct("mark_read");
          }}
          className="session-primary flex-1"
        >
          <ExternalLink size={17} aria-hidden="true" />
          {item.readMinutes ? `Read it · ${item.readMinutes} min` : "Read it"}
        </a>
        {active ? (
          <SdkButton
            disabled={busy}
            aria-label="Mark as read"
            title="Mark as read"
            onClick={() => onAct("mark_read")}
            className="round-tool"
          >
            <Check size={19} aria-hidden="true" />
          </SdkButton>
        ) : (
          <SdkButton
            disabled={busy}
            aria-label="Back to unread"
            title="Back to unread"
            onClick={() => onAct("restore")}
            className="round-tool"
          >
            <Undo2 size={19} aria-hidden="true" />
          </SdkButton>
        )}
        {item.status !== "dropped" && item.status !== "expired" ? (
          <SdkButton
            disabled={busy}
            aria-label="Drop it"
            title="Drop it"
            onClick={() => onAct("drop")}
            className="round-tool"
          >
            <Trash2 size={19} aria-hidden="true" />
          </SdkButton>
        ) : null}
      </div>
      <a
        href={`/links/${item.id}`}
        className="text-primary mt-4 text-sm font-semibold hover:underline"
      >
        Note, tags and reader view
      </a>
    </section>
  );
}
