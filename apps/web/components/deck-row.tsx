// SPDX-License-Identifier: AGPL-3.0-only
// One deck as a row: its stack of cards, its name, what it is from and how far along it
// is, and what is due. The same row on Home and on the Decks page.

import { DeckStack } from "./drawings";
import { cx } from "./ui";
import { pluralize } from "../lib/format";

const SOURCE: Record<string, string> = {
  resume: "From your resume",
  document: "From a document",
  manual: "Written by you",
};

export interface DeckRowData {
  id: string;
  name: string;
  kind: string;
  pausedAt: Date | string | null;
  counts: { total: number; learned: number; due: number };
}

export function DeckRow({ deck, divided }: { deck: DeckRowData; divided?: boolean }) {
  const source = SOURCE[deck.kind] ?? "From topics";
  const meta =
    deck.counts.total === 0
      ? `${source} · no questions yet`
      : `${source} · ${pluralize(deck.counts.total, "question")}${
          deck.counts.learned > 0 ? `, ${deck.counts.learned} learned` : ""
        }`;
  return (
    <a
      href={`/decks/${deck.id}`}
      className={cx(
        "relative -mx-2 flex items-center gap-3.5 rounded-[10px] px-2 py-3.5 transition-colors lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_60%,transparent)]",
      )}
    >
      {divided ? (
        <span
          aria-hidden="true"
          className="border-border absolute left-[62px] right-2 top-0 border-t-[0.5px]"
        />
      ) : null}
      <DeckStack
        id={deck.id}
        kind={deck.kind}
        total={deck.counts.total}
        learned={deck.counts.learned}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="font-display line-clamp-2 text-lg font-[580] leading-[1.2]">
          {deck.name}
        </span>
        <span className="text-muted-foreground truncate text-[13px]">{meta}</span>
      </span>
      {deck.pausedAt ? (
        <span className="text-muted-foreground ml-2.5 shrink-0 text-sm">Paused</span>
      ) : deck.counts.due > 0 ? (
        <span className="text-primary ml-2.5 shrink-0 text-sm font-semibold">
          {deck.counts.due} due
        </span>
      ) : null}
    </a>
  );
}
