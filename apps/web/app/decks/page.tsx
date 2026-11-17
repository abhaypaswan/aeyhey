// SPDX-License-Identifier: AGPL-3.0-only
// Decks, as the phone app has them.
//
// Each deck is drawn as a small stack of cards in its own colour, thicker with more
// questions, its top card filled as far as it is learned. Rows are grouped by what needs
// you, under quiet headings, and a new deck starts from an empty dashed card at the top.
// A wide screen lays each group out in two columns, so a dozen decks still fit on one
// screen.

import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { DashedCard, DeckStack } from "../../components/drawings";
import { LinkButton, cx } from "../../components/ui";
import { pluralize } from "../../lib/format";

export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = {
  resume: "From your resume",
  document: "From a document",
  manual: "Written by you",
};

export default async function DecksPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  // The built-in Links deck is not a question deck, so it is not listed here.
  const decks = (await repos.listDecks(state.context.scope)).filter(
    (deck) => deck.kind !== "links",
  );

  if (decks.length === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl px-[22px] pb-20 pt-7 sm:px-6 lg:px-8 lg:pt-14">
        <div className="max-w-xl">
          <DashedCard color="var(--color-primary)" width={60} height={80}>
            <Plus size={26} aria-hidden="true" />
          </DashedCard>
          <h1 className="font-display mt-6 text-[25px] font-[560] leading-[1.18] lg:text-[34px]">
            Make your first deck
          </h1>
          <p className="text-muted-foreground mt-2.5 text-[15px] leading-[1.45] lg:text-base">
            Type what you want to learn, or upload a book, your notes or a chapter. Aeyhey writes
            questions with model answers, and new ones arrive before each reminder.
          </p>
          <div className="mt-[22px]">
            <LinkButton href="/decks/new" tone="primary" size="lg" icon={Plus} className="home-cta">
              New deck
            </LinkButton>
          </div>
        </div>
      </main>
    );
  }

  const groups = [
    {
      label: "Due now",
      decks: decks
        .filter((deck) => !deck.pausedAt && deck.counts.due > 0)
        .sort((a, b) => b.counts.due - a.counts.due),
    },
    {
      label: "Up to date",
      decks: decks.filter(
        (deck) => !deck.pausedAt && deck.counts.due === 0 && deck.counts.total > 0,
      ),
    },
    { label: "Paused", decks: decks.filter((deck) => deck.pausedAt && deck.counts.total > 0) },
    { label: "Still empty", decks: decks.filter((deck) => deck.counts.total === 0) },
  ].filter((group) => group.decks.length > 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-[22px] pb-20 pt-2 sm:px-6 lg:px-8 lg:pt-8">
      <a
        href="/decks/new"
        className="group -mx-2 flex items-center gap-3.5 rounded-[10px] px-2 py-3 transition-colors lg:max-w-md lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_60%,transparent)]"
      >
        <span className="grid h-12 w-10 shrink-0 place-items-center">
          <DashedCard color="var(--color-primary)">
            <Plus size={16} aria-hidden="true" />
          </DashedCard>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-primary text-lg font-semibold">New deck</span>
          <span className="text-muted-foreground text-[13px]">
            From topics, a document or your resume
          </span>
        </span>
      </a>

      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2 className="font-display pb-0.5 pt-[26px] text-[17px] font-[640] tracking-[-0.006em] lg:pt-9 lg:text-xl">
            {group.label}
          </h2>
          <ul className="grid lg:grid-cols-2 lg:gap-x-12">
            {group.decks.map((deck, index) => {
              const source = SOURCE[deck.kind] ?? "From topics";
              const meta =
                deck.counts.total === 0
                  ? `${source} · no questions yet`
                  : `${source} · ${pluralize(deck.counts.total, "question")}${
                      deck.counts.learned > 0 ? `, ${deck.counts.learned} learned` : ""
                    }`;
              return (
                <li key={deck.id} className="relative">
                  {/* The hairline sits above every row but the first in its column. */}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "border-border absolute left-[54px] right-0 top-0 border-t-[0.5px]",
                      index === 0 && "hidden",
                      index === 1 && "lg:hidden",
                    )}
                  />
                  <a
                    href={`/decks/${deck.id}`}
                    className="-mx-2 flex items-center gap-3.5 rounded-[10px] px-2 py-3.5 transition-colors lg:hover:bg-[color-mix(in_srgb,var(--color-quiet)_60%,transparent)]"
                  >
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
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
