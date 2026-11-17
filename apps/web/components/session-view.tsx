"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The session view (PRD 8.3, 12.1 screen 3).
//
// One card at a time, with that card's own actions and nothing else on screen. The things
// that make it feel right rather than merely work:
//
//   - every action has a keyboard shortcut, and they are shown (FR-S-6)
//   - undo stays available for 10 seconds after any action (FR-S-5)
//   - while a grade is being written, "Show answer instead" stays available, because a
//     slow model must never trap the user (12.2)
//   - the model answer is fetched only when the user asks for it, so it is not sitting in
//     the page that is asking the question

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastRegion,
  ToastTitle,
  createToaster,
  type Toaster,
} from "@ui-sdk/react/toast";
import { apiClient, ApiRequestError } from "../lib/client";
import { hostOf, midSentence, relativeDate, tagLabel } from "../lib/format";
import { Button, Card, Kbd, Notice, ProgressDots, Spinner, Tag, Textarea, cx } from "./ui";
import { BrandMark } from "./nav";
import { AlertTriangle, Brain, Check, Clock, Sparkles, Trash2, SiteIcon, X } from "./icons";

interface LinkCardView {
  kind: "link";
  cardId: string;
  linkId: string;
  title: string;
  url: string;
  siteName?: string;
  summaryLines?: [string, string, string];
  whySaved?: string;
  summaryConfidence?: "high" | "low";
  tags: string[];
  note?: string;
  readMinutes?: number;
  savedAt: string;
  status: string;
  lastChance: boolean;
}

interface QuestionCardView {
  kind: "question";
  cardId: string;
  questionId: string;
  text: string;
  tags: string[];
  difficulty: string;
  category: string;
  sourceLabel: string;
  isNew: boolean;
}

type CardView = LinkCardView | QuestionCardView;

interface SessionPayload {
  session: { id: string } | null;
  items: CardView[];
  progress: { total: number; done: number; position: number } | null;
  nextSessionLabel: string;
  emptyReason?: "nothing_due" | "nothing_saved" | "paused";
  counts: { questionsDue: number; linksDue: number; newQuestions: number };
}

interface GradeResult {
  score: number;
  verdict: string;
  covered_points: string[];
  missed_points: string[];
  mistakes: string[];
  feedback: string;
  better_answer_tip?: string;
}

interface AnswerResponse {
  grade: GradeResult | null;
  suggestedRating: number;
  suggestedRatingWord: string;
  modelAnswer: string;
  gradeId: string | null;
  via: string;
  notice?: string;
}

interface ActionResponse {
  nextDueLabel: string;
  reviewId: string;
  openUrl?: string;
}

const RATING_LABELS: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export function SessionView({ initial }: { initial: SessionPayload }) {
  const [payload, setPayload] = useState(initial);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Question card state, reset on every card.
  const [mode, setMode] = useState<"front" | "answering" | "graded">("front");
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);

  // Undo, available for 10 seconds (FR-S-5). The toast is what the user sees; this
  // state is what the "U" shortcut reads, since a shortcut has no toast to click.
  const [undo, setUndo] = useState<{ reviewId: string; label: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toaster] = useState(() => createToaster());
  // runUndo is defined below, so the toast's action reads it through a ref rather than
  // capturing a stale copy of it.
  const runUndoRef = useRef<() => void>(() => {});

  const card = payload.items[index];
  const sessionId = payload.session?.id;

  const resetCardState = useCallback(() => {
    setMode("front");
    setAnswer("");
    setResult(null);
    setGrading(false);
    setError(null);
  }, []);

  const offerUndo = useCallback(
    (reviewId: string, label: string) => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ reviewId, label });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
      // Only the most recent action can be undone, so an older offer is withdrawn
      // rather than left on screen promising something it can no longer do.
      toaster.dismiss();
      toaster(label, {
        duration: UNDO_WINDOW_MS,
        action: { label: "Undo", onAction: () => runUndoRef.current() },
      });
    },
    [toaster],
  );

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      toaster.dismiss();
    };
  }, [toaster]);

  const advance = useCallback(() => {
    resetCardState();
    setIndex((current) => current + 1);
  }, [resetCardState]);

  const act = useCallback(
    async (body: unknown, options: { openUrl?: boolean } = {}) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);

      try {
        const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
        const response = await apiClient.post<ActionResponse>(
          `/api/cards/${card.cardId}/actions${query}`,
          body,
        );

        // Read now opens the original. Done before advancing, so the tab opens from the
        // click the user actually made and is not caught by a popup blocker.
        if (options.openUrl && response.openUrl) {
          window.open(response.openUrl, "_blank", "noopener,noreferrer");
        }

        offerUndo(response.reviewId, response.nextDueLabel);
        advance();
      } catch (thrown) {
        setError(
          thrown instanceof ApiRequestError
            ? thrown.message
            : "That did not go through. Try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [card, busy, sessionId, offerUndo, advance],
  );

  const submitAnswer = useCallback(async () => {
    if (!card || card.kind !== "question" || answer.trim() === "") return;
    setGrading(true);
    setError(null);

    try {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const response = await apiClient.post<AnswerResponse>(
        `/api/cards/${card.cardId}/actions${query}`,
        { action: "answer", answer },
      );
      setResult(response);
      setMode("graded");
    } catch (thrown) {
      setError(
        thrown instanceof ApiRequestError
          ? thrown.message
          : "Grading did not work. Reveal instead.",
      );
      // Falling back to reveal keeps the review possible, which matters more than the grade.
      await reveal();
    } finally {
      setGrading(false);
    }
  }, [card, answer, sessionId]);

  const reveal = useCallback(async () => {
    if (!card || card.kind !== "question") return;
    try {
      const response = await apiClient.post<{ modelAnswer: string; suggestedRating: number }>(
        `/api/cards/${card.cardId}/actions`,
        { action: "reveal" },
      );
      setResult({
        grade: null,
        suggestedRating: response.suggestedRating,
        suggestedRatingWord: RATING_LABELS[response.suggestedRating] ?? "Hard",
        modelAnswer: response.modelAnswer,
        gradeId: null,
        via: "reveal",
      });
      setMode("graded");
    } catch {
      setError("Could not load the answer.");
    }
  }, [card]);

  const dontKnow = useCallback(async () => {
    if (!card || card.kind !== "question") return;
    try {
      const response = await apiClient.post<{ modelAnswer: string; suggestedRating: number }>(
        `/api/cards/${card.cardId}/dont-know`,
      );
      setResult({
        grade: null,
        suggestedRating: response.suggestedRating,
        suggestedRatingWord: "Again",
        modelAnswer: response.modelAnswer,
        gradeId: null,
        via: "dont_know",
      });
      setMode("graded");
    } catch {
      setError("Could not load the answer.");
    }
  }, [card]);

  const rate = useCallback(
    (rating: number) =>
      act({
        action: "rate",
        rating,
        via: result?.grade ? "answer" : mode === "graded" ? "reveal" : "quick",
        ...(result?.gradeId ? { gradeId: result.gradeId } : {}),
      }),
    [act, result, mode],
  );

  const runUndo = useCallback(async () => {
    if (!undo) return;
    try {
      await apiClient.post(`/api/reviews/${undo.reviewId}/undo`);
      setUndo(null);
      toaster.dismiss();
      // Step back to the card that was just acted on.
      setIndex((current) => Math.max(0, current - 1));
      resetCardState();
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "Could not undo that.");
    }
  }, [undo, resetCardState, toaster]);

  runUndoRef.current = () => void runUndo();

  // Keyboard shortcuts (FR-S-6). Skipped while typing, or the answer box would be unusable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "u" && undo) {
        event.preventDefault();
        void runUndo();
        return;
      }
      if (!card) return;

      if (card.kind === "link") {
        if (key === "r") {
          event.preventDefault();
          void act({ action: "read" }, { openUrl: true });
        } else if (key === "l") {
          event.preventDefault();
          void act({ action: "snooze", variant: "default" });
        } else if (key === "d") {
          event.preventDefault();
          void act({ action: "drop" });
        }
        return;
      }

      if (mode === "graded" && ["1", "2", "3", "4"].includes(key)) {
        event.preventDefault();
        void rate(Number(key));
        return;
      }
      if (mode === "front") {
        if (key === "a") {
          event.preventDefault();
          setMode("answering");
        } else if (event.key === " ") {
          event.preventDefault();
          void reveal();
        } else if (key === "s") {
          event.preventDefault();
          void act({ action: "skip" });
        } else if (["1", "2", "3", "4"].includes(key)) {
          event.preventDefault();
          void rate(Number(key));
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, mode, undo, act, rate, reveal, runUndo]);

  // ---------------------------------------------------------------- empty and finished

  if (payload.emptyReason === "paused") {
    return (
      <Shell toaster={toaster}>
        <Notice tone="info">
          Reminders are paused. Turn them back on in Settings when you want them.
        </Notice>
      </Shell>
    );
  }

  if (!card) {
    const done = payload.progress?.total ?? 0;
    return (
      <Shell toaster={toaster}>
        <SessionEnd
          done={done}
          nextSessionLabel={payload.nextSessionLabel}
          counts={payload.counts}
          emptyReason={payload.emptyReason}
          onMore={async () => {
            const next = await apiClient.post<SessionPayload>("/api/session/start", { size: 5 });
            setPayload(next);
            setIndex(0);
            resetCardState();
          }}
        />
      </Shell>
    );
  }

  const total = payload.progress?.total ?? payload.items.length;
  const doneCount = (payload.progress?.done ?? 0) + index;

  return (
    <Shell toaster={toaster}>
      <ProgressDots total={total} done={doneCount} />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {card.kind === "link" ? (
        <LinkCardBody card={card} busy={busy} onAct={act} />
      ) : (
        <QuestionCardBody
          card={card}
          mode={mode}
          answer={answer}
          grading={grading}
          result={result}
          busy={busy}
          onAnswer={() => setMode("answering")}
          onAnswerChange={setAnswer}
          onSubmit={submitAnswer}
          onReveal={reveal}
          onDontKnow={dontKnow}
          onSkip={() => act({ action: "skip" })}
          onRate={rate}
        />
      )}
    </Shell>
  );
}

const UNDO_WINDOW_MS = 10_000;

function Shell({
  children,
  toaster,
}: {
  children: React.ReactNode;
  toaster: Toaster<React.ReactNode>;
}) {
  return (
    // The session has no sidebar: one card, its actions, and a way out. On a wide screen
    // the room beside the card holds the keyboard shortcuts, which is the one thing worth
    // glancing at mid-session.
    <div className="flex min-h-dvh flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-6 lg:px-10">
        <a href="/" className="flex items-center gap-2.5 text-base font-extrabold">
          <BrandMark />
          Aeyhey
        </a>
        <a
          href="/"
          className="text-muted-foreground hover:bg-sunken hover:text-foreground inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold"
        >
          <X size={15} aria-hidden="true" />
          Leave session
        </a>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-10 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-5">{children}</main>

        <aside
          aria-label="Keyboard shortcuts"
          className="border-border bg-surface shadow-card hidden flex-col gap-4 rounded-xl border p-5 xl:flex"
        >
          <p className="text-sm font-bold">Keyboard</p>
          {SHORTCUTS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <p className="text-subtle-foreground text-2xs font-bold uppercase tracking-[0.08em]">
                {group.label}
              </p>
              {group.keys.map(([key, what]) => (
                <div
                  key={key}
                  className="text-muted-foreground flex items-center justify-between text-sm"
                >
                  {what}
                  <Kbd>{key}</Kbd>
                </div>
              ))}
            </div>
          ))}
        </aside>
      </div>

      {/* Mounted by every branch, so an undo offered on the last card survives the move
          to the end of the session. */}
      <ToastRegion toaster={toaster} className="aeyhey-toasts">
        {() => (
          <Toast>
            <ToastTitle />
            <ToastAction />
            <ToastClose aria-label="Dismiss" />
          </Toast>
        )}
      </ToastRegion>
    </div>
  );
}

/** The same bindings the keydown handler above listens for (PRD 8.3 FR-S-6). */
const SHORTCUTS: { label: string; keys: [string, string][] }[] = [
  {
    label: "On a link",
    keys: [
      ["R", "Read it now"],
      ["L", "See it later"],
      ["D", "Drop it"],
    ],
  },
  {
    label: "On a question",
    keys: [
      ["A", "Write an answer"],
      ["Space", "Show the answer"],
      ["S", "Skip this one"],
      ["1 to 4", "Rate yourself"],
    ],
  },
  { label: "Any time", keys: [["U", "Undo the last action"]] },
];

function LinkCardBody({
  card,
  busy,
  onAct,
}: {
  card: LinkCardView;
  busy: boolean;
  onAct: (body: unknown, options?: { openUrl?: boolean }) => void;
}) {
  return (
    <>
      <Card className="flex flex-col gap-4">
        {card.lastChance ? (
          <Notice tone="warning" icon={AlertTriangle}>
            Last chance. Read it or snooze it, or it expires after this.
          </Notice>
        ) : null}

        <div className="flex flex-col gap-2">
          {/* The site's own favicon, so you recognise where this came from before
              reading anything. Fetched from the site itself, never through a favicon
              service, which would tell someone else every link you saved. */}
          <div className="text-subtle-foreground flex items-center gap-1.5 text-xs">
            <SiteIcon url={card.url} siteName={card.siteName} size={16} />
            <span className="truncate">{card.siteName ?? hostOf(card.url)}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{relativeDate(card.savedAt)}</span>
            {card.readMinutes ? (
              <span className="bg-sunken ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium">
                <Clock size={10} aria-hidden="true" />
                {card.readMinutes} min
              </span>
            ) : null}
          </div>
          <h1 className="text-xl font-bold leading-tight lg:text-2xl">{card.title}</h1>
        </div>

        {card.summaryLines ? (
          <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
            {card.summaryLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No summary for this one yet. The title and the link are below.
          </p>
        )}

        {card.summaryConfidence === "low" ? (
          <p className="text-muted-foreground text-xs italic">Summary from the title only.</p>
        ) : null}

        {card.whySaved ? (
          <p className="border-border text-muted-foreground border-l-2 pl-3 text-sm italic">
            {card.whySaved}
          </p>
        ) : null}

        {card.note ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Your note: </span>
            {card.note}
          </p>
        ) : null}

        {card.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <Tag key={tag}>{tagLabel(tag)}</Tag>
            ))}
          </div>
        ) : null}

        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-muted-foreground truncate text-xs underline"
        >
          {card.url}
        </a>
      </Card>

      <div className="flex flex-col gap-2">
        <Button
          tone="primary"
          size="lg"
          icon={Check}
          disabled={busy}
          shortcut="R"
          fullWidth
          onClick={() => onAct({ action: "read" }, { openUrl: true })}
        >
          Read now
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={Clock}
            disabled={busy}
            shortcut="L"
            onClick={() => onAct({ action: "snooze", variant: "default" })}
          >
            Later
          </Button>
          <Button
            icon={Trash2}
            disabled={busy}
            shortcut="D"
            onClick={() => onAct({ action: "drop" })}
          >
            Drop
          </Button>
        </div>
      </div>

      <div className="flex justify-center gap-4 text-xs">
        <a href={`/links/${card.linkId}`} className="text-muted-foreground underline">
          Reader view
        </a>
        <a href={`/links/${card.linkId}#tags`} className="text-muted-foreground underline">
          Edit tags
        </a>
      </div>
    </>
  );
}

function QuestionCardBody({
  card,
  mode,
  answer,
  grading,
  result,
  busy,
  onAnswer,
  onAnswerChange,
  onSubmit,
  onReveal,
  onDontKnow,
  onSkip,
  onRate,
}: {
  card: QuestionCardView;
  mode: "front" | "answering" | "graded";
  answer: string;
  grading: boolean;
  result: AnswerResponse | null;
  busy: boolean;
  onAnswer: () => void;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  onReveal: () => void;
  onDontKnow: () => void;
  onSkip: () => void;
  onRate: (rating: number) => void;
}) {
  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="text-subtle-foreground flex flex-wrap items-center gap-1.5 text-xs">
          <Brain size={13} aria-hidden="true" />
          <span className="truncate">{card.sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{card.difficulty}</span>
          {card.isNew ? (
            <span className="bg-info-soft text-info text-2xs rounded-full px-1.5 py-0.5 font-semibold">
              New
            </span>
          ) : null}
        </div>
        <h1 className="text-xl font-bold leading-snug lg:text-2xl">{card.text}</h1>

        {card.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <Tag key={tag}>{tagLabel(tag)}</Tag>
            ))}
          </div>
        ) : null}

        {mode === "answering" ? (
          <div className="flex flex-col gap-3">
            <Textarea
              autoFocus
              value={answer}
              onChange={(event) => onAnswerChange(event.target.value)}
              placeholder="Answer in your own words. Two or three sentences is plenty."
              rows={7}
              maxLength={4000}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="primary" disabled={answer.trim() === "" || grading} onClick={onSubmit}>
                {grading ? "Grading" : "Submit"}
              </Button>
              <Button tone="ghost" onClick={onDontKnow}>
                I do not know
              </Button>
              {/* Stays available while grading, so a slow model never traps the user. */}
              <Button tone="ghost" onClick={onReveal}>
                Show answer instead
              </Button>
            </div>
            {grading ? <Spinner label="Reading your answer" /> : null}
          </div>
        ) : null}

        {mode === "graded" && result ? <GradeBody result={result} /> : null}
      </Card>

      {mode === "front" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button tone="primary" icon={Sparkles} shortcut="A" onClick={onAnswer} disabled={busy}>
              Answer
            </Button>
            <Button shortcut="Space" onClick={onReveal} disabled={busy}>
              Reveal
            </Button>
            <Button shortcut="S" onClick={onSkip} disabled={busy}>
              Skip
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button shortcut="4" onClick={() => onRate(4)} disabled={busy}>
              Easy
            </Button>
            <Button shortcut="2" onClick={() => onRate(2)} disabled={busy}>
              Hard
            </Button>
          </div>
        </>
      ) : null}

      {mode === "graded" && result ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-center text-xs">How did you do?</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((rating) => (
              <Button
                key={rating}
                tone={rating === result.suggestedRating ? "primary" : "secondary"}
                shortcut={String(rating)}
                disabled={busy}
                onClick={() => onRate(rating)}
              >
                {RATING_LABELS[rating]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function GradeBody({ result }: { result: AnswerResponse }) {
  return (
    <div className="flex flex-col gap-4">
      {result.notice ? <Notice tone="warning">{result.notice}</Notice> : null}

      {result.grade ? (
        <>
          <div className="flex items-center gap-3">
            <div
              className={cx(
                "grid size-16 shrink-0 place-items-center rounded-2xl",
                result.grade.score >= 65
                  ? "bg-success-soft text-success"
                  : result.grade.score >= 40
                    ? "bg-warning-soft text-warning"
                    : "bg-danger-soft text-danger",
              )}
            >
              <span className="text-2xl font-bold tabular-nums leading-none">
                {result.grade.score}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold capitalize">{result.grade.verdict}</span>
              <span className="text-subtle-foreground text-xs">out of 100</span>
            </div>
          </div>

          <p className="text-sm leading-relaxed">{result.grade.feedback}</p>

          {result.grade.covered_points.length > 0 ? (
            <PointList title="What you got" points={result.grade.covered_points} tone="success" />
          ) : null}
          {result.grade.missed_points.length > 0 ? (
            <PointList title="What you missed" points={result.grade.missed_points} tone="warning" />
          ) : null}
          {result.grade.mistakes.length > 0 ? (
            <PointList title="Not quite right" points={result.grade.mistakes} tone="danger" />
          ) : null}
        </>
      ) : null}

      <div className="border-border border-t pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide">Model answer</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{result.modelAnswer}</div>
      </div>
    </div>
  );
}

function PointList({
  title,
  points,
  tone,
}: {
  title: string;
  points: string[];
  tone: "success" | "warning" | "danger";
}) {
  const dot = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <ul className="flex flex-col gap-1">
        {points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionEnd({
  done,
  nextSessionLabel,
  counts,
  emptyReason,
  onMore,
}: {
  done: number;
  nextSessionLabel: string;
  counts: { questionsDue: number; linksDue: number };
  emptyReason?: string;
  onMore: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const more = counts.questionsDue + counts.linksDue > 0;

  if (emptyReason === "nothing_saved") {
    return (
      <Card className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold">Nothing saved yet</h1>
        <p className="text-muted-foreground text-sm">
          Paste some links, or make a deck of questions, and they will start coming back to you.
        </p>
        <div className="flex gap-2">
          <Button tone="primary" onClick={() => (window.location.href = "/add")}>
            Add links
          </Button>
          <Button onClick={() => (window.location.href = "/decks")}>New deck</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-lg font-semibold">
        {done > 0 ? "Session done" : "You are all caught up"}
      </h1>
      <p className="text-muted-foreground text-sm">Next session {midSentence(nextSessionLabel)}.</p>

      {more ? (
        <Button
          tone="primary"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await onMore();
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "Building" : "Do 5 more"}
        </Button>
      ) : null}

      <a href="/" className="text-muted-foreground text-xs underline">
        Back to today
      </a>
    </Card>
  );
}
