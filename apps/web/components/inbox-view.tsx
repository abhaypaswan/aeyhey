"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The inbox (PRD 8.1 FR-LINK-8, 12.1 screen 4).
//
// Three things make this screen work rather than merely function:
//   - on a wide screen the list has a reading pane beside it, so the summary and the
//     actions for a link are one click away without leaving the list
//   - every row leads with the site's own favicon and a content-type icon, so a video, a
//     paper and a GitHub repo are told apart without reading
//   - the tag list collapses after one row. Fourteen identical grey pills is a wall, and
//     a wall is not a filter.

import { useState } from "react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@ui-sdk/react/toolbar";
import { apiClient, ApiRequestError } from "../lib/client";
import { hostOf, relativeDate, tagLabel } from "../lib/format";
import {
  Archive,
  Check,
  ExternalLink,
  Hash,
  Inbox,
  Plus,
  Trash2,
  X,
  contentTypeIcon,
  contentTypeLabel,
  SiteIcon,
} from "../components/icons";
import {
  Button,
  EmptyState,
  Input,
  LinkButton,
  Notice,
  Page,
  PageHeader,
  SectionLabel,
  StatusPill,
  Tag,
  cx,
} from "./ui";

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
}

interface Counts {
  unread: number;
  snoozed: number;
  read: number;
  dropped: number;
  expiring: number;
  expired: number;
}

const CHIPS: { status: keyof Counts; label: string }[] = [
  { status: "unread", label: "Unread" },
  { status: "snoozed", label: "Snoozed" },
  { status: "expiring", label: "Last chance" },
  { status: "read", label: "Read" },
  { status: "dropped", label: "Dropped" },
  { status: "expired", label: "Expired" },
];

const TAGS_BEFORE_COLLAPSE = 8;

const TOOL =
  "text-muted-foreground hover:bg-sunken hover:text-foreground inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors data-disabled:pointer-events-none data-disabled:opacity-45";

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
  activeStatus: string | null;
  activeTag: string | null;
  query: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(nextCursor);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(query);
  const [showAllTags, setShowAllTags] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const visibleTags = showAllTags ? tags : tags.slice(0, TAGS_BEFORE_COLLAPSE);

  function linkTo(next: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const merged = { status: activeStatus, tag: activeTag, q: search || null, ...next };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(action: string): Promise<void> {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);

    try {
      await apiClient.post("/api/links/bulk", { ids: [...selected], action });
      const nextStatus =
        action === "drop"
          ? "dropped"
          : action === "restore"
            ? "unread"
            : action === "mark_read"
              ? "read"
              : null;
      if (nextStatus) {
        setItems((current) =>
          current.map((item) => (selected.has(item.id) ? { ...item, status: nextStatus } : item)),
        );
      }
      setSelected(new Set());
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!cursor) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ cursor, limit: "50" });
      if (activeStatus) params.set("status", activeStatus);
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

  /** One link, acted on from the reading pane. Same endpoint as the bulk bar. */
  async function actOn(id: string, action: "mark_read" | "drop" | "restore"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/api/links/bulk", { ids: [id], action });
      const nextStatus = action === "drop" ? "dropped" : action === "restore" ? "unread" : "read";
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, status: nextStatus } : item)),
      );
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Inbox"
        subtitle={`Every link you saved, and where each one stands. ${total} saved, ${counts.unread} unread.`}
        action={
          // The top bar already has Add on a phone, so a second one here is only clutter.
          <span className="max-lg:hidden">
            <LinkButton href="/add" tone="primary" icon={Plus}>
              Add links
            </LinkButton>
          </span>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form action="/inbox" className="relative lg:w-80 lg:shrink-0">
            {activeStatus ? <input type="hidden" name="status" value={activeStatus} /> : null}
            {activeTag ? <input type="hidden" name="tag" value={activeTag} /> : null}
            <Input
              name="q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, summaries and notes"
              aria-label="Search your links"
              className="pr-20"
            />
            <Button
              type="submit"
              size="sm"
              tone="ghost"
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
            >
              Search
            </Button>
          </form>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 max-sm:[scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
            <Chip
              href={linkTo({ status: null })}
              active={!activeStatus}
              label="All"
              count={total}
            />
            {CHIPS.map((chip) => (
              <Chip
                key={chip.status}
                href={linkTo({ status: chip.status })}
                active={activeStatus === chip.status}
                label={chip.label}
                count={counts[chip.status]}
              />
            ))}
          </div>
        </div>

        {tags.length > 0 ? (
          // One row that scrolls sideways on a phone, where two or three wrapped rows of tags
          // would push the links themselves off the first screen.
          <div className="flex flex-wrap items-center gap-1.5 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:[scrollbar-width:none]">
            <Hash size={13} aria-hidden="true" className="text-subtle-foreground shrink-0" />
            {visibleTags.map((tag) => (
              <a
                key={tag}
                href={linkTo({ tag: activeTag === tag ? null : tag })}
                className="shrink-0"
              >
                <span
                  className={cx(
                    "text-2xs inline-flex min-h-7 items-center rounded-md px-2 font-medium transition-colors",
                    activeTag === tag
                      ? "bg-primary text-primary-foreground"
                      : "bg-sunken text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tagLabel(tag)}
                </span>
              </a>
            ))}
            {tags.length > TAGS_BEFORE_COLLAPSE ? (
              <SdkButton
                onClick={() => setShowAllTags((current) => !current)}
                className="text-subtle-foreground hover:text-foreground text-2xs min-h-7 shrink-0 px-1.5 font-semibold"
              >
                {showAllTags ? "Show fewer" : `${tags.length - TAGS_BEFORE_COLLAPSE} more`}
              </SdkButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {selected.size > 0 ? (
        // One tab stop for the whole bar, with the arrow keys moving between its actions.
        <Toolbar
          aria-label="Actions for the selected links"
          className="bg-surface border-border shadow-raised sticky top-16 z-20 flex flex-wrap items-center gap-1 rounded-xl border p-2"
        >
          <span className="px-1.5 text-sm font-semibold">{selected.size} selected</span>
          <span className="ml-auto" />
          <ToolbarButton className={TOOL} disabled={busy} onClick={() => bulk("mark_read")}>
            <Check size={14} aria-hidden="true" />
            Read
          </ToolbarButton>
          <ToolbarButton className={TOOL} disabled={busy} onClick={() => bulk("drop")}>
            <Trash2 size={14} aria-hidden="true" />
            Drop
          </ToolbarButton>
          <ToolbarButton className={TOOL} disabled={busy} onClick={() => bulk("restore")}>
            <Archive size={14} aria-hidden="true" />
            Restore
          </ToolbarButton>
          <ToolbarSeparator className="bg-border mx-1 h-5 w-px" />
          <ToolbarButton className={TOOL} onClick={() => setSelected(new Set())}>
            <X size={14} aria-hidden="true" />
            Clear
          </ToolbarButton>
        </Toolbar>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing here"
          body={
            search
              ? "No links match that search. Try a shorter phrase."
              : "Paste some links and they will show up here."
          }
          action={
            <Button tone="primary" onClick={() => (window.location.href = "/add")}>
              Add links
            </Button>
          }
        />
      ) : (
        // The list, and beside it on a wide screen a reading pane for whichever link is
        // picked, so going through a pile does not mean a page load per link.
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.85fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <ul className="bg-surface border-border shadow-card divide-border flex flex-col divide-y overflow-hidden rounded-xl border">
              {items.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  previewed={preview?.id === item.id}
                  onToggle={() => toggle(item.id)}
                  onPreview={() => setPreviewId(item.id)}
                />
              ))}
            </ul>

            {cursor ? (
              <Button disabled={busy} onClick={loadMore} fullWidth>
                {busy ? "Loading" : "Load more"}
              </Button>
            ) : null}
          </div>

          {preview ? <ReadingPane item={preview} busy={busy} onAct={actOn} /> : null}
        </div>
      )}
    </Page>
  );
}

/** True when the reading pane is on screen, which is the xl breakpoint and up. */
function paneIsVisible(): boolean {
  return window.matchMedia("(min-width: 1280px)").matches;
}

function InboxRow({
  item,
  selected,
  previewed,
  onToggle,
  onPreview,
}: {
  item: InboxItem;
  selected: boolean;
  previewed: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const TypeIcon = contentTypeIcon(item.contentType);

  return (
    <li
      className={cx(
        "group relative p-4 transition-colors max-sm:px-3.5",
        selected ? "bg-primary-soft/50" : previewed ? "xl:bg-sunken" : "hover:bg-sunken/60",
      )}
    >
      {previewed ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-0 left-0 hidden w-0.5 xl:block"
        />
      ) : null}
      <div className="flex gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.title ?? item.url}`}
          className="mt-0.5 shrink-0"
        >
          <CheckboxIndicator>
            <Check size={13} aria-hidden="true" />
          </CheckboxIndicator>
        </Checkbox>

        {/* The favicon gives way on a phone: the title needs the width more. */}
        <span className="max-sm:hidden">
          <SiteIcon url={item.url} siteName={item.siteName} size={32} />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <a
              href={`/links/${item.id}`}
              // With the reading pane showing, a click opens the link there. Without it,
              // and for a modified click, this stays an ordinary link to the full page.
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || !paneIsVisible()) return;
                event.preventDefault();
                onPreview();
              }}
              aria-current={previewed ? "true" : undefined}
              // Two lines on a phone rather than one cut short: half a title is not enough
              // to recognise a link by.
              className="decoration-border text-sm font-semibold hover:underline hover:underline-offset-2 max-sm:line-clamp-2 sm:truncate"
            >
              {item.title ?? item.url}
            </a>
            <StatusPill status={item.status} />
          </div>

          <div className="text-subtle-foreground flex items-center gap-1.5 text-xs">
            <span className="truncate">{item.siteName ?? hostOf(item.url)}</span>
            <span aria-hidden="true">&middot;</span>
            <TypeIcon size={11} aria-hidden="true" className="shrink-0" />
            <span className="shrink-0">{contentTypeLabel(item.contentType)}</span>
            {item.readMinutes ? (
              <>
                <span aria-hidden="true">&middot;</span>
                <span className="shrink-0">{item.readMinutes} min</span>
              </>
            ) : null}
            <span aria-hidden="true">&middot;</span>
            <span className="shrink-0">{relativeDate(item.savedAt)}</span>
          </div>

          {item.aiStatus === "pending" ? (
            <p className="text-subtle-foreground text-xs italic">Writing the summary</p>
          ) : item.summaryLines ? (
            <p className="text-muted-foreground clamp-2 text-sm">{item.summaryLines[0]}</p>
          ) : null}

          {item.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {item.tags.slice(0, 5).map((tag) => (
                <Tag key={tag}>{tagLabel(tag)}</Tag>
              ))}
            </div>
          ) : null}
        </div>
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
  onAct: (id: string, action: "mark_read" | "drop" | "restore") => Promise<void>;
}) {
  const active = ["unread", "snoozed", "expiring"].includes(item.status);

  return (
    <section
      aria-label="Selected link"
      className="bg-surface border-border shadow-card sticky top-20 hidden max-h-[calc(100dvh-6.5rem)] flex-col gap-4 overflow-y-auto rounded-xl border p-6 xl:flex"
    >
      <div className="text-subtle-foreground flex flex-wrap items-center gap-2 text-xs">
        <StatusPill status={item.status} />
        <span>{item.siteName ?? hostOf(item.url)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{relativeDate(item.savedAt)}</span>
        {item.readMinutes ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{item.readMinutes} min read</span>
          </>
        ) : null}
      </div>

      <h2 className="text-xl font-bold leading-snug">{item.title ?? item.url}</h2>

      {item.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <Tag key={tag}>{tagLabel(tag)}</Tag>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Summary</SectionLabel>
        {item.aiStatus === "pending" ? (
          <p className="text-muted-foreground text-sm italic">The summary is being written.</p>
        ) : item.summaryLines ? (
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed">
            {item.summaryLines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm italic">No summary for this one.</p>
        )}
      </div>

      {item.whySaved ? (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Why you probably saved this</SectionLabel>
          <p className="text-muted-foreground text-sm leading-relaxed">{item.whySaved}</p>
        </div>
      ) : null}

      <div className="border-border mt-1 flex flex-wrap items-center gap-2 border-t pt-4">
        {active ? (
          <>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => void onAct(item.id, "mark_read")}
              className="bg-primary text-primary-foreground hover:bg-primary-hover shadow-card inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Read it now
            </a>
            <Button icon={Check} disabled={busy} onClick={() => void onAct(item.id, "mark_read")}>
              Mark as read
            </Button>
            <Button
              tone="ghost"
              icon={Trash2}
              disabled={busy}
              onClick={() => void onAct(item.id, "drop")}
            >
              Drop it
            </Button>
          </>
        ) : (
          <>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="border-border bg-surface hover:border-border-strong shadow-card inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open the original
            </a>
            <Button icon={Archive} disabled={busy} onClick={() => void onAct(item.id, "restore")}>
              Put it back in the queue
            </Button>
          </>
        )}
        <a
          href={`/links/${item.id}`}
          className="text-primary ml-auto text-sm font-semibold hover:underline"
        >
          Notes and reader view
        </a>
      </div>
    </section>
  );
}

function Chip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <a
      href={href}
      className={cx(
        "text-2xs inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-semibold transition-colors",
        active
          ? "bg-foreground text-canvas"
          : "bg-sunken text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined ? (
        <span className={cx("tabular-nums", active ? "opacity-60" : "opacity-50")}>{count}</span>
      ) : null}
    </a>
  );
}
