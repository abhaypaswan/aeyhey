"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The parts of a link's page that change things: its note, its tags, and what to do
// with it. The phone app has the same rows and the same actions; here a wide screen
// keeps the actions beside the article rather than pinned under it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Copy, Ellipsis, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { apiClient, ApiRequestError } from "../lib/client";
import { cx } from "./ui";

interface LinkFacts {
  id: string;
  url: string;
  status: string;
  readMinutes: number | null;
  note: string | null;
  tags: string[];
}

function useLinkActions(link: LinkFacts) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function run(
    work: () => Promise<unknown>,
    done: string,
    after?: () => void,
  ): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ text: done });
      after?.();
      router.refresh();
    } catch (thrown) {
      setMessage({
        text:
          thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const bulk = (action: string) => () =>
    apiClient.post("/api/links/bulk", { ids: [link.id], action });

  return { busy, message, setMessage, run, bulk };
}

/** Read it, mark it read, drop it: the phone's bottom bar, beside the article on desktop. */
export function LinkActions({ link }: { link: LinkFacts }) {
  const { busy, message, run, bulk } = useLinkActions(link);
  const open = ["unread", "snoozed", "expiring"].includes(link.status);
  const gone = link.status === "dropped" || link.status === "expired";

  return (
    <div className="link-actions">
      <div className="flex items-center gap-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={() => {
            if (open) void run(bulk("mark_read"), "Marked as read.");
          }}
          className="session-primary flex-1"
        >
          <BookOpen size={17} aria-hidden="true" />
          {link.readMinutes ? `Read it · ${link.readMinutes} min` : "Read it"}
        </a>
        {open ? (
          <SdkButton
            disabled={busy}
            aria-label="Mark as read"
            title="Mark as read"
            onClick={() => void run(bulk("mark_read"), "Marked as read.")}
            className="round-tool"
          >
            <Check size={19} aria-hidden="true" />
          </SdkButton>
        ) : null}
        {gone ? null : (
          <SdkButton
            disabled={busy}
            aria-label="Drop it"
            title="Drop it"
            onClick={() =>
              void run(bulk("drop"), "Dropped.", () => {
                window.location.href = "/inbox";
              })
            }
            className="round-tool"
          >
            <Trash2 size={19} aria-hidden="true" />
          </SdkButton>
        )}
      </div>
      {message ? (
        <p
          role="status"
          className={cx("mt-2 text-sm", message.error ? "text-danger" : "text-muted-foreground")}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Copy, summarise again, back to unread: the phone's "more" menu. */
export function LinkMoreMenu({ link }: { link: LinkFacts }) {
  const { run, bulk } = useLinkActions(link);
  return (
    <Menu>
      <MenuTrigger
        aria-label="More"
        className="text-foreground hover:bg-quiet grid size-10 place-items-center rounded-full transition-colors"
      >
        <Ellipsis size={20} aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end" className="later-menu min-w-48">
        <MenuItem onSelect={() => void navigator.clipboard.writeText(link.url)}>
          <Copy size={17} aria-hidden="true" />
          Copy link
        </MenuItem>
        <MenuItem
          onSelect={() =>
            void run(() => apiClient.post(`/api/links/${link.id}/reprocess`), "Fetching it again.")
          }
        >
          <BookOpen size={17} aria-hidden="true" />
          Summarise again
        </MenuItem>
        {link.status !== "unread" ? (
          <MenuItem onSelect={() => void run(bulk("restore"), "Back in your queue.")}>
            <Undo2 size={17} aria-hidden="true" />
            Back to unread
          </MenuItem>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/** The detail rows: a note, the tags, the address. Each edits in place. */
export function LinkDetails({ link }: { link: LinkFacts }) {
  const router = useRouter();
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(link.note ?? "");
  const [tags, setTags] = useState(link.tags);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      await apiClient.patch(`/api/links/${link.id}`, body);
      router.refresh();
      return true;
    } catch (thrown) {
      setError(
        thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
      );
      return false;
    }
  }

  async function saveNote(): Promise<void> {
    if (await patch({ note: note.trim() === "" ? null : note.trim() })) setEditingNote(false);
  }

  async function addTag(): Promise<void> {
    const tag = newTag.trim().toLowerCase().replace(/^#/, "");
    if (tag === "" || tags.includes(tag)) {
      setAddingTag(false);
      setNewTag("");
      return;
    }
    const next = [...tags, tag];
    setTags(next);
    setNewTag("");
    setAddingTag(false);
    if (!(await patch({ tags: next }))) setTags(tags);
  }

  async function removeTag(tag: string): Promise<void> {
    const next = tags.filter((item) => item !== tag);
    setTags(next);
    if (!(await patch({ tags: next }))) setTags(tags);
  }

  return (
    <dl className="border-border flex flex-col border-t-[0.5px]">
      <Row label="Note">
        {editingNote ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why this matters to you"
              className="link-field"
            />
            <div className="flex gap-2">
              <SdkButton type="submit" className="session-primary min-h-9! px-4! text-sm!">
                Save
              </SdkButton>
              <SdkButton
                onClick={() => {
                  setNote(link.note ?? "");
                  setEditingNote(false);
                }}
                className="quiet-pill h-9!"
              >
                Cancel
              </SdkButton>
            </div>
          </form>
        ) : link.note ? (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[15px] leading-[1.45]">{link.note}</p>
            <SdkButton
              aria-label="Edit note"
              onClick={() => setEditingNote(true)}
              className="text-muted-foreground hover:bg-quiet grid size-8 shrink-0 place-items-center rounded-full"
            >
              <Pencil size={16} aria-hidden="true" />
            </SdkButton>
          </div>
        ) : (
          <SdkButton
            onClick={() => setEditingNote(true)}
            className="text-primary flex items-center gap-1.5 text-[14.5px] font-medium"
          >
            <Plus size={14} aria-hidden="true" />
            Add a note about why it matters
          </SdkButton>
        )}
      </Row>

      <Row label="Tags" id="tags">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="border-border inline-flex h-7 items-center rounded-full border pl-2.5 text-[13px]"
            >
              #{tag}
              <SdkButton
                aria-label={`Remove ${tag}`}
                onClick={() => void removeTag(tag)}
                className="text-subtle-foreground hover:text-foreground grid h-full place-items-center pl-1 pr-2"
              >
                <X size={13} aria-hidden="true" />
              </SdkButton>
            </span>
          ))}
          {addingTag ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addTag();
              }}
              className="border-primary inline-flex h-7 items-center rounded-full border pl-2.5 text-[13px]"
            >
              #
              <input
                autoFocus
                value={newTag}
                maxLength={40}
                onChange={(event) => setNewTag(event.target.value)}
                onBlur={() => void addTag()}
                placeholder="postgres"
                aria-label="New tag"
                className="w-24 bg-transparent pr-2.5 outline-none"
              />
            </form>
          ) : (
            <SdkButton
              onClick={() => setAddingTag(true)}
              className="text-primary flex h-7 items-center gap-1 px-1 text-[13px] font-medium"
            >
              <Plus size={13} aria-hidden="true" />
              Add tag
            </SdkButton>
          )}
        </div>
      </Row>

      <Row label="Link">
        <div className="flex items-start gap-2">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-muted-foreground line-clamp-2 flex-1 break-all text-[13.5px] hover:underline"
          >
            {link.url}
          </a>
          <SdkButton
            aria-label="Copy link"
            onClick={() => void navigator.clipboard.writeText(link.url)}
            className="text-muted-foreground hover:bg-quiet grid size-8 shrink-0 place-items-center rounded-full"
          >
            <Copy size={16} aria-hidden="true" />
          </SdkButton>
        </div>
      </Row>
      {error ? <p className="text-danger pt-2 text-sm">{error}</p> : null}
    </dl>
  );
}

function Row({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="border-border flex gap-3 border-b-[0.5px] py-3.5">
      <dt className="text-muted-foreground w-16 shrink-0 pt-0.5 text-[13px]">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
