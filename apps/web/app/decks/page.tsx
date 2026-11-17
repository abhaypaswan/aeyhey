// SPDX-License-Identifier: AGPL-3.0-only
// Decks (PRD 12.1 screen 7).

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { Bar, Button, Page, PageHeader } from "../../components/ui";
import { pluralize } from "../../lib/format";
import { Brain, ChevronRight, FileText, Sparkles } from "../../components/icons";

export const dynamic = "force-dynamic";

export default async function DecksPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  // The built-in Links deck is not a question deck, so it is not listed here.
  const decks = (await repos.listDecks(state.context.scope)).filter(
    (deck) => deck.kind !== "links",
  );

  const due = decks
    .filter((deck) => !deck.pausedAt)
    .reduce((sum, deck) => sum + deck.counts.due, 0);

  return (
    <Page>
      <PageHeader
        title="Decks"
        subtitle="Sets of questions Aeyhey asks you over time. Answer in your own words, get a score, and see what you missed."
        eyebrow={`${pluralize(decks.length, "deck")}${due > 0 ? `, ${due} due now` : ""}`}
      />

      {/* On a phone the single column is told it may shrink. Left to size itself it grows
          to fit the longest deck name and pushes the page sideways. */}
      <div className="grid gap-4 max-sm:grid-cols-[minmax(0,1fr)] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {/* The two ways to make a deck are forms, not links, and each says what it does:
            someone new should not have to press one to find out. */}
        <NewDeckCard
          from="topics"
          icon={Sparkles}
          title="New deck from topics"
          body="Type a few topics, such as Postgres indexing or system design. Aeyhey writes the questions and a worked answer for each."
          action="Start with topics"
          primary
        />
        <NewDeckCard
          from="resume"
          icon={FileText}
          title="New deck from your resume"
          body="Paste or upload your resume and name the role you want. Get the interview questions you are likely to be asked."
          action="Use my resume"
        />

        {decks.map((deck) => {
          const learned =
            deck.counts.total === 0 ? 0 : (deck.counts.learned / deck.counts.total) * 100;

          return (
            <a
              key={deck.id}
              href={`/decks/${deck.id}`}
              className="bg-surface border-border shadow-card lift flex flex-col gap-4 rounded-xl border p-5"
            >
              <span className="flex items-center gap-3">
                <span className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                  {deck.kind === "resume" ? (
                    <FileText size={18} aria-hidden="true" />
                  ) : (
                    <Brain size={18} aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{deck.name}</span>
                  <span className="text-subtle-foreground text-xs">
                    {deck.kind === "resume" ? "From your resume" : "From topics"}
                  </span>
                </span>
                {deck.pausedAt ? (
                  <span className="bg-sunken text-muted-foreground text-2xs shrink-0 rounded-full px-2 py-0.5 font-bold">
                    Paused
                  </span>
                ) : deck.counts.due > 0 ? (
                  <span className="bg-primary-soft text-primary text-2xs shrink-0 rounded-full px-2 py-0.5 font-bold">
                    {deck.counts.due} due
                  </span>
                ) : null}
              </span>

              <Bar value={learned} tone="success" label={`Questions learned in ${deck.name}`} />

              <span className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <DeckCount value={deck.counts.total} label="questions" />
                <DeckCount value={deck.counts.learned} label="learned" />
                <DeckCount value={deck.counts.new} label="new" />
                {deck.counts.suspended > 0 ? (
                  <DeckCount value={deck.counts.suspended} label="suspended" />
                ) : null}
              </span>

              <span className="text-primary mt-auto inline-flex items-center gap-1 text-sm font-semibold">
                Open deck
                <ChevronRight size={15} aria-hidden="true" />
              </span>
            </a>
          );
        })}
      </div>
    </Page>
  );
}

function DeckCount({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-foreground text-base font-bold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function NewDeckCard({
  from,
  icon: IconComponent,
  title,
  body,
  action,
  primary,
}: {
  from: "topics" | "resume";
  icon: typeof Brain;
  title: string;
  body: string;
  action: string;
  primary?: boolean;
}) {
  return (
    <form
      action="/decks/new"
      className="border-border-strong flex flex-col gap-3 rounded-xl border border-dashed p-5 max-sm:gap-2 max-sm:p-4"
    >
      <input type="hidden" name="from" value={from} />
      <span className="bg-sunken text-muted-foreground grid size-10 place-items-center rounded-xl max-sm:hidden">
        <IconComponent size={18} aria-hidden="true" />
      </span>
      <h2 className="font-bold">{title}</h2>
      <p className="text-muted-foreground text-sm">{body}</p>
      <div className="mt-auto pt-1">
        <Button tone={primary ? "primary" : "secondary"} type="submit" className="max-sm:w-full">
          {action}
        </Button>
      </div>
    </form>
  );
}
