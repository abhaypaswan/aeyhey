"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The review list (PRD 8.2 FR-Q-3).
//
// Everything is kept by default, because a model that did its job should not need twenty
// confirmations. The work here is making it easy to drop the two that missed, and to fix
// a question whose wording is nearly right.

import { useState } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { ChevronDown } from "lucide-react";
import { apiClient, ApiRequestError } from "../lib/client";
import { tagLabel } from "../lib/format";
import { Button, Card, Notice, Page, PageHeader, Tag, Textarea } from "./ui";
import { pluralize } from "../lib/format";

interface PendingQuestion {
  id: string;
  text: string;
  modelAnswer: string;
  keyPoints: string[];
  category: string;
  difficulty: string;
  resumeAnchor: string | null;
  tags: string[];
}

export function ReviewQuestions({
  deckId,
  deckName,
  questions,
}: {
  deckId: string;
  deckName: string;
  questions: PendingQuestion[];
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, { text?: string; modelAnswer?: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keeping = questions.filter((question) => !removed.has(question.id));

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await apiClient.post("/api/questions/accept", {
        keepIds: keeping.map((question) => question.id),
        removeIds: [...removed],
        edits: Object.entries(edits).map(([id, patch]) => ({ id, ...patch })),
      });
      window.location.href = `/decks/${deckId}`;
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "Those did not save.");
      setBusy(false);
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/decks", label: "Decks" }}
        eyebrow="Review before scheduling"
        title={deckName}
        subtitle={`${pluralize(questions.length, "question")} written. Drop any that missed, then keep the rest. Only the ones you keep get scheduled.`}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="bg-surface/90 border-border sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 backdrop-blur">
        <span className="text-sm font-medium">
          Keeping {keeping.length} of {questions.length}
        </span>
        <Button tone="primary" disabled={busy || keeping.length === 0} onClick={accept}>
          {busy ? "Saving" : keeping.length === questions.length ? "Keep all" : "Keep these"}
        </Button>
      </div>

      <ul className="flex flex-col gap-3">
        {questions.map((question, index) => {
          const isRemoved = removed.has(question.id);
          const edit = edits[question.id];
          const isEditing = editing === question.id;

          return (
            <li key={question.id}>
              <Card className={isRemoved ? "opacity-50" : undefined}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      {index + 1} &middot; {question.category.replace(/_/g, " ")} &middot;{" "}
                      {question.difficulty}
                      {question.resumeAnchor ? ` · ${question.resumeAnchor}` : ""}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        tone="ghost"
                        onClick={() => setEditing(isEditing ? null : question.id)}
                      >
                        {isEditing ? "Done" : "Edit"}
                      </Button>
                      <Button
                        tone="ghost"
                        onClick={() =>
                          setRemoved((current) => {
                            const next = new Set(current);
                            if (next.has(question.id)) next.delete(question.id);
                            else next.add(question.id);
                            return next;
                          })
                        }
                      >
                        {isRemoved ? "Keep" : "Remove"}
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <Textarea
                      value={edit?.text ?? question.text}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [question.id]: { ...current[question.id], text: event.target.value },
                        }))
                      }
                      rows={3}
                      className="font-semibold"
                    />
                  ) : (
                    <p className="text-sm font-semibold leading-snug">
                      {edit?.text ?? question.text}
                    </p>
                  )}

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
                    <CollapsiblePanel className="text-sm">
                      {isEditing ? (
                        <Textarea
                          value={edit?.modelAnswer ?? question.modelAnswer}
                          onChange={(event) =>
                            setEdits((current) => ({
                              ...current,
                              [question.id]: {
                                ...current[question.id],
                                modelAnswer: event.target.value,
                              },
                            }))
                          }
                          rows={8}
                          className="mt-2"
                        />
                      ) : (
                        <div className="mt-2 whitespace-pre-wrap leading-relaxed">
                          {edit?.modelAnswer ?? question.modelAnswer}
                        </div>
                      )}

                      {question.keyPoints.length > 0 ? (
                        <div className="text-muted-foreground mt-3 text-xs">
                          <p className="mb-1 font-semibold">Graded on</p>
                          <ul className="list-inside list-disc">
                            {question.keyPoints.map((point, i) => (
                              <li key={i}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </CollapsiblePanel>
                  </Collapsible>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button tone="primary" disabled={busy || keeping.length === 0} onClick={accept} fullWidth>
        {busy ? "Saving" : `Keep ${pluralize(keeping.length, "question")}`}
      </Button>
    </Page>
  );
}
