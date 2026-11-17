"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Deck detail (PRD 8.2 FR-Q-6, 12.1 screen 10).

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { tagLabel } from "../lib/format";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { ChevronDown } from "lucide-react";
import {
  Bar,
  Button,
  Card,
  CardTitle,
  Columns,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  Tag,
} from "./ui";
import { ConfirmButton } from "./confirm";

interface DeckQuestion {
  id: string;
  text: string;
  modelAnswer: string;
  keyPoints: string[];
  category: string;
  difficulty: string;
  tags: string[];
}

const DIFFICULTIES = [
  { value: "all", label: "All" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export function DeckDetail({
  deck,
  questions,
}: {
  deck: { id: string; name: string; kind: string; hasSource: boolean; paused: boolean };
  questions: DeckQuestion[];
}) {
  const [items, setItems] = useState(questions);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(deck.paused);

  const shown = filter === "all" ? items : items.filter((item) => item.difficulty === filter);

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiClient.delete(`/api/questions/${id}`);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function setDeckPaused(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/api/decks/${deck.id}`, { paused: next });
      setPaused(next);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const byDifficulty = DIFFICULTIES.filter((option) => option.value !== "all").map((option) => ({
    ...option,
    count: items.filter((item) => item.difficulty === option.value).length,
  }));

  return (
    <Page>
      <PageHeader
        back={{ href: "/decks", label: "Decks" }}
        title={deck.name}
        subtitle={`${items.length} questions, written ${
          deck.kind === "resume" ? "from your resume" : "from the topics you gave"
        }. Each one comes back in your sessions on its own schedule.`}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {paused ? (
        <Notice tone="warning">
          This deck is paused. Its questions are kept, but none are asked and no new ones are
          written until you resume it.
        </Notice>
      ) : null}

      <Columns
        asideFirstOnPhone
        aside={
          <>
            <Card className="flex flex-col gap-4">
              <CardTitle hint="Sessions mix this deck with your links and other decks.">
                Practise
              </CardTitle>
              <form action="/session" className="contents">
                <Button tone="primary" type="submit" fullWidth>
                  Start a session
                </Button>
              </form>
              {deck.hasSource && !paused ? (
                // Aeyhey writes new questions itself, just before each reminder.
                <p className="text-muted-foreground text-sm">
                  New questions arrive before each reminder.
                </p>
              ) : null}
            </Card>

            <Card className="flex flex-col gap-3">
              <CardTitle
                hint={
                  paused
                    ? "Resume to get its questions in your sessions again, from where you left off."
                    : "Take a break from this deck without deleting it. Your questions and progress stay."
                }
              >
                {paused ? "Paused" : "Pause this deck"}
              </CardTitle>
              <Button
                tone={paused ? "primary" : "secondary"}
                disabled={busy}
                fullWidth
                onClick={() => setDeckPaused(!paused)}
              >
                {paused ? "Resume deck" : "Pause deck"}
              </Button>
            </Card>

            <Card className="flex flex-col gap-3">
              <CardTitle>By difficulty</CardTitle>
              {byDifficulty.map((row) => (
                <div key={row.value} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-semibold tabular-nums">{row.count}</span>
                  </div>
                  <Bar
                    label={`Share of questions that are ${row.label.toLowerCase()}`}
                    value={items.length === 0 ? 0 : (row.count / items.length) * 100}
                  />
                </div>
              ))}
            </Card>
          </>
        }
      >
        <SegmentedControl
          aria-label="Filter by difficulty"
          value={filter}
          onValueChange={(next) => next && setFilter(next)}
        >
          <SegmentedControlIndicator />
          {DIFFICULTIES.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value}>
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>

        {shown.length === 0 ? (
          <EmptyState title="Nothing here" body="No questions match that filter." />
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((question) => (
              <li key={question.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug">{question.text}</p>
                    <ConfirmButton
                      label="Delete"
                      disabled={busy}
                      title="Delete this question?"
                      description="It goes from this deck along with its review history. This cannot be undone."
                      confirmLabel="Delete it"
                      onConfirm={() => remove(question.id)}
                    />
                  </div>

                  <p className="text-muted-foreground text-xs">
                    {question.category.replace(/_/g, " ")} &middot; {question.difficulty}
                  </p>

                  {question.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {question.tags.map((tag) => (
                        <Tag key={tag}>{tagLabel(tag)}</Tag>
                      ))}
                    </div>
                  ) : null}

                  <Collapsible>
                    <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium">
                      <ChevronDown size={13} aria-hidden="true" />
                      Model answer
                    </CollapsibleTrigger>
                    <CollapsiblePanel className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                      {question.modelAnswer}
                    </CollapsiblePanel>
                  </Collapsible>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Columns>
    </Page>
  );
}
