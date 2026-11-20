"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The session: one card at a time, as the phone app shows it.
//
// A strip at the top has one segment per card, coloured by what you did with it, so the
// session's shape is visible at a glance. Below it, the card and its own actions and
// nothing else. On a phone the actions sit at the bottom, under the thumb; on a wide
// screen they sit under the card, in a reading-width column, with the keyboard shortcut
// on each button. The things that make it feel right rather than merely work:
//
//   - every action has a keyboard shortcut, and the buttons show it
//   - after any action a strip says when that card comes back, with Undo (or U)
//   - while a grade is being written, "Show the answer instead" stays available, because
//     a slow model must never trap anyone
//   - the model answer is fetched only when it is asked for, so it is not sitting in the
//     page that is asking the question

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  BookmarkPlus,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  History,
  Hourglass,
  SkipForward,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { apiClient, ApiRequestError } from "../lib/client";
import { hostOf, midSentence, pluralize, relativeDate } from "../lib/format";
import { hueFor, mix, siteKey, soft, strong, type Hue } from "../lib/hue";
import { CardsDone, DashedCard, DifficultyMark, SiteMark } from "./drawings";
import { IdeaTiles } from "./ideas";
import { Kbd, cx } from "./ui";

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

interface SessionSummary {
  cardsDone: number;
  linksRead: number;
  linksDropped: number;
  linksSnoozed: number;
  questionsAnswered: number;
  questionsSkipped: number;
  averageScore: number | null;
  writtenAnswers: number;
  moreAvailable: boolean;
  nextSessionLabel: string;
}

const RATINGS: { value: number; label: string; hue: Hue }[] = [
  { value: 1, label: "Again", hue: "red" },
  { value: 2, label: "Hard", hue: "amber" },
  { value: 3, label: "Good", hue: "green" },
  { value: 4, label: "Easy", hue: "blue" },
];

/** What a finished card's segment in the progress strip is coloured by. */
type Outcome = "read" | "later" | "dropped" | "skipped" | "again" | "hard" | "good" | "easy";

const OUTCOME_COLOR: Record<Outcome, string> = {
  read: strong("green"),
  good: strong("green"),
  later: strong("blue"),
  easy: strong("blue"),
  dropped: "var(--color-subtle-foreground)",
  skipped: strong("amber"),
  hard: strong("amber"),
  again: strong("red"),
};

function outcomeOf(body: Record<string, unknown>): Outcome {
  switch (body["action"]) {
    case "read":
      return "read";
    case "snooze":
      return "later";
    case "drop":
      return "dropped";
    case "skip":
      return "skipped";
    default: {
      const rating = Number(body["rating"]);
      return rating === 1 ? "again" : rating === 2 ? "hard" : rating === 4 ? "easy" : "good";
    }
  }
}

export function SessionView({ initial }: { initial: SessionPayload }) {
  const [payload, setPayload] = useState(initial);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  // Question card state, reset on every card.
  const [mode, setMode] = useState<"front" | "graded">("front");
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  // The last action, which the strip under the progress offers to undo.
  const [undo, setUndo] = useState<{ reviewId: string; label: string } | null>(null);

  const card = payload.items[index];
  const sessionId = payload.session?.id;

  const resetCardState = useCallback(() => {
    setMode("front");
    setAnswer("");
    setResult(null);
    setGrading(false);
    setError(null);
  }, []);

  const advance = useCallback(() => {
    resetCardState();
    setIndex((current) => current + 1);
  }, [resetCardState]);

  const act = useCallback(
    async (body: Record<string, unknown>, options: { openUrl?: boolean } = {}) => {
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
        // click that was actually made and is not caught by a popup blocker.
        if (options.openUrl && response.openUrl) {
          window.open(response.openUrl, "_blank", "noopener,noreferrer");
        }

        setUndo({ reviewId: response.reviewId, label: response.nextDueLabel });
        setOutcomes((list) => [...list, outcomeOf(body)]);
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
    [card, busy, sessionId, advance],
  );

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
        suggestedRatingWord:
          RATINGS.find((rating) => rating.value === response.suggestedRating)?.label ?? "Hard",
        modelAnswer: response.modelAnswer,
        gradeId: null,
        via: "reveal",
      });
      setMode("graded");
    } catch {
      setError("Could not load the answer.");
    }
  }, [card]);

  const submitAnswer = useCallback(async () => {
    if (!card || card.kind !== "question" || answer.trim() === "" || grading) return;
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
          : "Grading did not work. Here is the answer.",
      );
      // Falling back to reveal keeps the review possible, which matters more than the grade.
      await reveal();
    } finally {
      setGrading(false);
    }
  }, [card, answer, sessionId, grading, reveal]);

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
      setOutcomes((list) => list.slice(0, -1));
      // Step back to the card that was just acted on.
      setIndex((current) => Math.max(0, current - 1));
      resetCardState();
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "Could not undo that.");
    }
  }, [undo, resetCardState]);

  // Keyboard shortcuts. Skipped while typing, or the answer box would be unusable.
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

      if (["1", "2", "3", "4"].includes(key)) {
        event.preventDefault();
        void rate(Number(key));
        return;
      }
      if (mode === "front") {
        if (key === "a") {
          event.preventDefault();
          answerRef.current?.focus();
        } else if (event.key === " ") {
          event.preventDefault();
          void reveal();
        } else if (key === "s") {
          event.preventDefault();
          void act({ action: "skip" });
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, mode, undo, act, rate, reveal, runUndo]);

  const startMore = useCallback(async () => {
    const next = await apiClient.post<SessionPayload>("/api/session/start", { size: 5 });
    setPayload(next);
    setIndex(0);
    setOutcomes([]);
    setUndo(null);
    resetCardState();
  }, [resetCardState]);

  // ---------------------------------------------------------------- empty and finished

  if (!card) {
    const finished = (payload.progress?.total ?? 0) > 0 && sessionId;
    return (
      <Frame
        top={undo ? <UndoStrip label={undo.label} onUndo={() => void runUndo()} /> : null}
        progress={null}
      >
        {finished ? (
          <SessionDone sessionId={sessionId} onMore={startMore} />
        ) : (
          <EmptySession
            reason={payload.emptyReason}
            nextSessionLabel={payload.nextSessionLabel}
            onMore={startMore}
          />
        )}
      </Frame>
    );
  }

  const total = payload.progress?.total ?? payload.items.length;
  const before = payload.progress?.done ?? 0;
  const doneCount = before + index;

  return (
    <Frame
      progress={
        <Progress
          total={total}
          done={doneCount}
          outcomes={outcomes}
          before={before}
          kindAt={(position) => payload.items[position - before]?.kind ?? null}
        />
      }
      top={undo ? <UndoStrip label={undo.label} onUndo={() => void runUndo()} /> : null}
    >
      {error ? (
        <p role="alert" className="text-danger mb-4 text-sm font-medium">
          {error}
        </p>
      ) : null}

      <div key={card.cardId} className="session-card flex flex-1 flex-col">
        {card.kind === "link" ? (
          <LinkCard card={card} busy={busy} onAct={act} />
        ) : (
          <QuestionCard
            card={card}
            mode={mode}
            answer={answer}
            answerRef={answerRef}
            grading={grading}
            result={result}
            busy={busy}
            onAnswerChange={setAnswer}
            onSubmit={() => void submitAnswer()}
            onReveal={() => void reveal()}
            onSkip={() => void act({ action: "skip" })}
            onRate={(rating) => void rate(rating)}
          />
        )}
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------------- the frame

function Frame({
  progress,
  top,
  children,
}: {
  progress: React.ReactNode;
  top: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-3 pt-3 sm:px-6 lg:pt-6">
        <a
          href="/"
          aria-label="Close the session"
          className="text-foreground hover:bg-quiet grid size-10 shrink-0 place-items-center rounded-full transition-colors"
        >
          <X size={22} aria-hidden="true" />
        </a>
        <div className="min-w-0 flex-1 pr-2">{progress}</div>
      </header>
      {top ? <div className="mx-auto w-full max-w-3xl px-[22px] pt-2 sm:px-8">{top}</div> : null}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-[22px] pb-4 pt-5 sm:px-8 lg:pb-12 lg:pt-8">
        {children}
      </main>
    </div>
  );
}

function Progress({
  total,
  done,
  outcomes,
  before,
  kindAt,
}: {
  total: number;
  done: number;
  outcomes: Outcome[];
  before: number;
  kindAt: (position: number) => "link" | "question" | null;
}) {
  const current = Math.min(done + 1, total);
  const label = `Card ${current} of ${total}`;
  return (
    <div className="flex items-center gap-3" role="img" aria-label={label}>
      {total <= 12 ? (
        <div className="flex h-2.5 flex-1 items-center gap-1">
          {Array.from({ length: total }, (_, position) => {
            const isDone = position < done;
            const isCurrent = position === done;
            const kind = kindAt(position);
            const outcome = outcomes[position - before];
            const color = isDone
              ? outcome
                ? OUTCOME_COLOR[outcome]
                : "var(--color-primary)"
              : isCurrent
                ? strong(kind === "question" ? "violet" : "blue")
                : kind
                  ? soft(kind === "question" ? "violet" : "blue")
                  : "var(--color-border)";
            return (
              <span
                key={position}
                className="flex-1 rounded-full transition-all duration-200"
                style={{ height: isCurrent ? 10 : 6, background: color }}
              />
            );
          })}
        </div>
      ) : (
        <div className="bg-border h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}
      <span className="shrink-0 text-[15px] tabular-nums">
        <span className="font-bold">{current}</span>
        <span className="text-muted-foreground"> / {total}</span>
      </span>
    </div>
  );
}

function UndoStrip({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="bg-surface border-border flex items-center gap-2 rounded-xl border py-1 pl-3 pr-1"
    >
      <Check size={17} aria-hidden="true" style={{ color: "var(--color-success)" }} />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <SdkButton
        onClick={onUndo}
        className="text-primary hover:bg-quiet flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold"
      >
        Undo
        <span className="hidden lg:inline">
          <Kbd>U</Kbd>
        </span>
      </SdkButton>
    </div>
  );
}

// ------------------------------------------------------------------------ the buttons

function Action({
  children,
  onClick,
  disabled,
  primary,
  shortcut,
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  shortcut?: string;
  icon?: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  className?: string;
}) {
  return (
    <SdkButton
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      className={cx(primary ? "session-primary" : "quiet-pill session-quiet", "gap-2", className)}
    >
      {Icon ? <Icon size={17} aria-hidden /> : null}
      {children}
      {shortcut ? (
        <span className="hidden opacity-70 lg:inline">
          <Kbd>{shortcut === " " ? "Space" : shortcut}</Kbd>
        </span>
      ) : null}
    </SdkButton>
  );
}

/** A quote-like block with a coloured rule: your note, why you saved it, an answer. */
function Aside({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="w-[3px] shrink-0 rounded-sm"
        style={{ background: color }}
      />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-muted-foreground text-[13px] font-semibold">{label}</span>
        <div className="text-[15.5px] leading-[1.45]">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- a link card

function LinkCard({
  card,
  busy,
  onAct,
}: {
  card: LinkCardView;
  busy: boolean;
  onAct: (body: Record<string, unknown>, options?: { openUrl?: boolean }) => void;
}) {
  const hue = hueFor(siteKey(card.url, card.siteName));
  const saved = relativeDate(card.savedAt);
  return (
    <>
      <div className="flex flex-col">
        <div className="flex items-center gap-2.5">
          <SiteMark url={card.url} siteName={card.siteName} size={36} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14.5px] font-semibold">
              {card.siteName ?? hostOf(card.url)}
            </span>
            <span className="text-muted-foreground text-[13px]">
              {saved.charAt(0).toUpperCase() + saved.slice(1)}
            </span>
          </div>
          {card.readMinutes ? (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm">
              <Clock size={14} aria-hidden="true" />
              {card.readMinutes} min
            </span>
          ) : null}
        </div>

        {card.lastChance ? (
          <p
            className="mt-4 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm leading-[1.35]"
            style={{ background: soft("amber"), color: strong("amber") }}
          >
            <Hourglass size={17} aria-hidden="true" className="shrink-0" />
            Last chance. Read it or let it go: it expires after this.
          </p>
        ) : null}

        <h1 className="font-display mt-[18px] text-[26px] font-[620] leading-[1.2] lg:text-[34px]">
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="hover:underline"
          >
            {card.title}
          </a>
        </h1>

        {card.summaryLines ? (
          <ul className="mt-4 flex flex-col gap-2.5">
            {card.summaryLines.map((line, i) => (
              <li key={i} className="flex gap-3 text-[16.5px] leading-[1.5] lg:text-[17px]">
                <span
                  aria-hidden="true"
                  className="mt-[9px] size-1.5 shrink-0 rounded-full"
                  style={{ background: strong(hue) }}
                />
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-4 text-[15.5px]">
            No summary for this one yet. The title opens the original.
          </p>
        )}
        {card.summaryConfidence === "low" ? (
          <p className="text-muted-foreground mt-2 text-xs italic">
            Summary from part of the page.
          </p>
        ) : null}

        {card.note ? (
          <div className="mt-3">
            <Aside label="Your note" color="var(--color-primary)">
              {card.note}
            </Aside>
          </div>
        ) : null}
        {card.whySaved ? (
          <div className="mt-3">
            <Aside label="Why you probably saved it" color={strong(hue)}>
              {card.whySaved}
            </Aside>
          </div>
        ) : null}

        {card.tags.length > 0 ? (
          <p className="text-muted-foreground mt-[18px] text-sm [word-spacing:0.35em]">
            {card.tags.map((tag) => `#${tag}`).join(" ")}
          </p>
        ) : null}

        <p className="text-muted-foreground mt-4 flex gap-4 text-xs">
          <a href={`/links/${card.linkId}`} className="hover:text-foreground underline">
            Reader view
          </a>
          <a href={`/links/${card.linkId}#tags`} className="hover:text-foreground underline">
            Edit tags
          </a>
        </p>
      </div>

      <div className="session-actions">
        <Action
          primary
          icon={BookOpen}
          shortcut="R"
          disabled={busy}
          onClick={() => onAct({ action: "read" }, { openUrl: true })}
          className="w-full lg:w-auto lg:flex-[1.4]"
        >
          Read now
        </Action>
        <div className="grid grid-cols-2 gap-2.5 lg:flex lg:flex-1 lg:gap-2.5">
          <Action
            icon={Trash2}
            shortcut="D"
            disabled={busy}
            onClick={() => onAct({ action: "drop" })}
            className="lg:flex-1"
          >
            Drop
          </Action>
          <div className="flex lg:flex-[1.3]">
            <Action
              icon={Clock}
              shortcut="L"
              disabled={busy}
              onClick={() => onAct({ action: "snooze", variant: "default" })}
              className="rounded-r-none! flex-1"
            >
              Later
            </Action>
            <Menu>
              <MenuTrigger
                aria-label="More ways to put it off"
                disabled={busy}
                className="quiet-pill session-quiet rounded-l-none! border-l-0! px-0! w-[46px]"
              >
                <ChevronDown size={18} aria-hidden="true" />
              </MenuTrigger>
              <MenuContent side="top" align="end" className="later-menu">
                <MenuItem onSelect={() => onAct({ action: "snooze", variant: "tomorrow" })}>
                  <Calendar size={17} aria-hidden="true" />
                  Tomorrow
                </MenuItem>
                <MenuItem onSelect={() => onAct({ action: "snooze", variant: "default" })}>
                  <Clock size={17} aria-hidden="true" />
                  <span className="flex flex-col">
                    Later
                    <span className="text-muted-foreground text-xs">
                      Comes back less often each time you put it off
                    </span>
                  </span>
                </MenuItem>
                <MenuItem onSelect={() => onAct({ action: "snooze", variant: "much_later" })}>
                  <History size={17} aria-hidden="true" />
                  Much later
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------------------------------- a question card

function QuestionCard({
  card,
  mode,
  answer,
  answerRef,
  grading,
  result,
  busy,
  onAnswerChange,
  onSubmit,
  onReveal,
  onSkip,
  onRate,
}: {
  card: QuestionCardView;
  mode: "front" | "graded";
  answer: string;
  answerRef: React.RefObject<HTMLTextAreaElement | null>;
  grading: boolean;
  result: AnswerResponse | null;
  busy: boolean;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  onReveal: () => void;
  onSkip: () => void;
  onRate: (rating: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  const typing = focused || answer.trim() !== "";
  const chosen = Number(rating ?? result?.suggestedRating ?? 3);
  const chosenWord = RATINGS.find((item) => item.value === chosen)?.label ?? "Good";

  return (
    <>
      <div className="flex flex-col">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-[10px]"
            style={{ background: soft("violet"), color: strong("violet") }}
          >
            <Brain size={18} />
          </span>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="truncate text-[14.5px] font-semibold">{card.sourceLabel}</span>
            <span className="flex items-center gap-3">
              <DifficultyMark level={card.difficulty} />
              {card.isNew ? (
                <span className="text-primary text-[13px] font-semibold leading-none">
                  New question
                </span>
              ) : null}
            </span>
          </div>
        </div>

        <h1 className="font-display mt-[18px] text-2xl font-semibold leading-[1.3] lg:text-[30px]">
          {card.text}
        </h1>

        {mode === "graded" && answer.trim() !== "" ? (
          <div className="mt-5">
            <Aside label="Your answer" color="var(--color-primary)">
              <span className="whitespace-pre-wrap">{answer}</span>
            </Aside>
          </div>
        ) : null}

        {grading ? (
          <div className="text-muted-foreground mt-10 flex flex-col items-center gap-3 text-xs">
            <span className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
            Grading your answer
            {/* Stays available while grading, so a slow model never traps anyone. */}
            <SdkButton onClick={onReveal} className="text-primary text-sm font-semibold">
              Show the answer instead
            </SdkButton>
          </div>
        ) : null}

        {mode === "graded" && result ? <Outcome result={result} /> : null}
      </div>

      {mode === "graded" && result ? (
        <div className="session-actions flex-col! items-stretch!">
          <p className="text-center text-[13.5px] font-semibold">How well did you know it?</p>
          <SegmentedControl
            value={String(chosen)}
            onValueChange={(value) => setRating(value)}
            className="rating-pills"
            aria-label="How well did you know it?"
            style={
              {
                "--rating-chosen": strong(
                  RATINGS.find((item) => item.value === chosen)?.hue ?? "green",
                ),
              } as React.CSSProperties
            }
          >
            <SegmentedControlIndicator />
            {RATINGS.map((item) => (
              <SegmentedControlItem
                key={item.value}
                value={String(item.value)}
                style={{ "--rating-color": strong(item.hue) } as React.CSSProperties}
              >
                {item.label}
                <span className="ml-1.5 hidden opacity-70 lg:inline">{item.value}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <Action primary disabled={busy} onClick={() => onRate(chosen)} className="w-full">
            Rate it {chosenWord}
          </Action>
        </div>
      ) : grading ? null : (
        <div className="session-actions flex-col! items-stretch!">
          {typing ? null : (
            <>
              <p className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-1 text-xs">
                Already know it?
                <SdkButton
                  onClick={() => onRate(4)}
                  disabled={busy}
                  className="rounded-full px-2 py-1 text-sm font-semibold"
                  style={{ color: strong("blue") }}
                >
                  Easy
                </SdkButton>
                <SdkButton
                  onClick={() => onRate(2)}
                  disabled={busy}
                  className="rounded-full px-2 py-1 text-sm font-semibold"
                  style={{ color: strong("amber") }}
                >
                  Hard
                </SdkButton>
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <Action shortcut=" " disabled={busy} onClick={onReveal}>
                  Reveal
                </Action>
                <Action shortcut="S" disabled={busy} onClick={onSkip}>
                  Skip
                </Action>
              </div>
            </>
          )}
          <form
            className={cx(
              "bg-surface mt-1.5 flex items-end gap-1.5 rounded-3xl py-1 pl-4 pr-1.5",
              focused ? "border-primary border-[1.5px]" : "border-border border",
            )}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label htmlFor="answer" className="sr-only">
              Write your answer
            </label>
            <textarea
              id="answer"
              ref={answerRef}
              rows={1}
              maxLength={4000}
              value={answer}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => onAnswerChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Write your answer"
              className="placeholder:text-muted-foreground field-sizing-content max-h-48 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base leading-[1.4] outline-none"
            />
            <SdkButton
              type="submit"
              aria-label="Check my answer"
              disabled={answer.trim() === "" || grading}
              className={cx(
                "mb-0.5 grid size-10 shrink-0 place-items-center rounded-full transition-colors",
                answer.trim() === ""
                  ? "bg-border text-muted-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              <ArrowUp size={20} aria-hidden="true" />
            </SdkButton>
          </form>
          <p className="text-muted-foreground hidden text-center text-xs lg:block">
            <Kbd>A</Kbd> to write, <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to check it, <Kbd>1</Kbd> to{" "}
            <Kbd>4</Kbd> to rate straight away
          </p>
        </div>
      )}
    </>
  );
}

function Outcome({ result }: { result: AnswerResponse }) {
  const grade = result.grade;
  const scoreColor = grade
    ? grade.score >= 75
      ? "var(--color-success)"
      : grade.score >= 45
        ? "var(--color-warning)"
        : "var(--color-danger)"
    : "";
  const verdict = grade
    ? grade.verdict === "correct"
      ? "Right"
      : grade.verdict === "incorrect"
        ? "Missed"
        : "Partly right"
    : "";

  return (
    <div className="flex flex-col">
      {result.notice ? <p className="text-muted-foreground mt-4 text-xs">{result.notice}</p> : null}

      {grade ? (
        <div
          className="mt-5 flex flex-col rounded-[14px] px-4 pb-4 pt-3.5"
          style={{ background: mix("var(--color-canvas)", scoreColor, 0.07, 0.14) }}
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-display text-[40px] font-[680] tabular-nums leading-none"
              style={{ color: scoreColor }}
            >
              {grade.score}
            </span>
            <span className="text-muted-foreground text-sm">out of 100</span>
            <span className="ml-auto text-[15px] font-bold" style={{ color: scoreColor }}>
              {verdict}
            </span>
          </div>
          <p className="mt-2.5 text-[15px] leading-[1.45]">{grade.feedback}</p>
          <PointList
            title="What you got"
            points={grade.covered_points}
            icon={CircleCheck}
            color="var(--color-success)"
          />
          <PointList
            title="What you missed"
            points={grade.missed_points}
            icon={Circle}
            color="var(--color-warning)"
          />
          <PointList
            title="Mistakes"
            points={grade.mistakes}
            icon={CircleAlert}
            color="var(--color-danger)"
          />
          {grade.better_answer_tip ? (
            <p className="text-muted-foreground mt-3 text-[13.5px] leading-[1.4]">
              Tip: {grade.better_answer_tip}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-[22px]">
        <Aside label="Model answer" color="var(--color-success)">
          <div className="whitespace-pre-wrap text-base leading-[1.5]">{result.modelAnswer}</div>
        </Aside>
      </div>
    </div>
  );
}

function PointList({
  title,
  points,
  icon: Icon,
  color,
}: {
  title: string;
  points: string[];
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
}) {
  if (points.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <p className="text-[13.5px] font-bold">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {points.map((point, i) => (
          <li key={i} className="flex items-start gap-2 text-[13.5px] leading-[1.4]">
            <Icon size={18} className="shrink-0" style={{ color }} />
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------- the end of it

function EmptySession({
  reason,
  nextSessionLabel,
  onMore,
}: {
  reason: SessionPayload["emptyReason"];
  nextSessionLabel: string;
  onMore: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const more = async (): Promise<void> => {
    setLoading(true);
    try {
      await onMore();
    } finally {
      setLoading(false);
    }
  };

  const view =
    reason === "paused"
      ? {
          art: (
            <span className="bg-primary-soft grid place-items-center rounded-[22px] p-[18px]">
              <CirclePause size={32} aria-hidden="true" />
            </span>
          ),
          title: "Reminders are paused",
          body: "You can still do a few cards early.",
          action: (
            <Action primary disabled={loading} onClick={() => void more()}>
              {loading ? "Building" : "Do 5 cards"}
            </Action>
          ),
        }
      : reason === "nothing_saved"
        ? {
            art: (
              <span className="flex items-end gap-2" aria-hidden="true">
                <DashedCard color="var(--color-subtle-foreground)" width={46} height={60} />
                <DashedCard color="var(--color-primary)" width={54} height={70}>
                  <BookmarkPlus size={22} />
                </DashedCard>
                <DashedCard color="var(--color-subtle-foreground)" width={46} height={60} />
              </span>
            ),
            // Also what someone sees once every link is read and there are no questions, so
            // it must not claim they never saved anything.
            title: "Nothing to review yet",
            body: "Save a link or make a deck of questions, and your next session will be here.",
            action: <IdeaTiles className="w-full max-w-2xl" />,
          }
        : {
            art: <CardsDone scale={1.5} />,
            title: "You are all caught up",
            body: `Next session ${midSentence(nextSessionLabel)}.`,
            action: (
              <Action disabled={loading} onClick={() => void more()}>
                {loading ? "Building" : "Do a few extra"}
              </Action>
            ),
          };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="mb-2">{view.art}</div>
      <h1 className="font-display text-[28px] font-[650] leading-[1.1] tracking-[-0.015em] lg:text-[34px]">
        {view.title}
      </h1>
      <p className="text-muted-foreground max-w-md text-[15.5px] leading-[1.5]">{view.body}</p>
      <div className="mt-3 flex w-full justify-center">{view.action}</div>
      <a href="/" className="text-muted-foreground text-sm underline">
        Back to Home
      </a>
    </div>
  );
}

function SessionDone({ sessionId, onMore }: { sessionId: string; onMore: () => Promise<void> }) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiClient
      .get<SessionSummary>(`/api/session/${sessionId}/summary`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [sessionId]);

  const rows: { icon: React.ComponentType<{ size?: number }>; hue: Hue; text: string }[] = [];
  if (summary) {
    if (summary.linksRead)
      rows.push({
        icon: BookOpen,
        hue: "green",
        text: `${pluralize(summary.linksRead, "link")} read`,
      });
    if (summary.linksSnoozed)
      rows.push({
        icon: Clock,
        hue: "blue",
        text: `${pluralize(summary.linksSnoozed, "link")} for later`,
      });
    if (summary.linksDropped)
      rows.push({
        icon: Trash2,
        hue: "red",
        text: `${pluralize(summary.linksDropped, "link")} dropped`,
      });
    if (summary.questionsAnswered)
      rows.push({
        icon: Brain,
        hue: "violet",
        text: `${pluralize(summary.questionsAnswered, "question")} answered`,
      });
    if (summary.questionsSkipped)
      rows.push({
        icon: SkipForward,
        hue: "amber",
        text: `${pluralize(summary.questionsSkipped, "question")} skipped`,
      });
    if (summary.writtenAnswers && summary.averageScore !== null)
      rows.push({
        icon: Star,
        hue: "orange",
        text:
          summary.writtenAnswers === 1
            ? `1 written answer, scored ${summary.averageScore} out of 100`
            : `${summary.writtenAnswers} written answers, averaging ${summary.averageScore} out of 100`,
      });
  }

  return (
    <div className="flex flex-1 flex-col lg:justify-center">
      <div className="flex flex-col pt-3">
        <span
          className="grid size-16 place-items-center rounded-full"
          style={{ background: soft("green"), color: strong("green") }}
        >
          <Check size={32} aria-hidden="true" />
        </span>
        <h1 className="font-display mt-5 text-[30px] font-[640] leading-[1.1] lg:text-[40px]">
          Session done
        </h1>
        <p className="text-muted-foreground mt-1.5 text-base leading-[1.45]">
          {summary
            ? `${pluralize(summary.cardsDone, "card")} done. Next session ${midSentence(summary.nextSessionLabel)}.`
            : "Nice work."}
        </p>
        <ul className="mt-[26px] flex flex-col gap-3.5">
          {rows.map((row) => (
            <li key={row.text} className="flex items-center gap-3.5 text-base">
              <span
                aria-hidden="true"
                className="grid size-[34px] shrink-0 place-items-center rounded-[10px]"
                style={{ background: soft(row.hue), color: strong(row.hue) }}
              >
                <row.icon size={17} />
              </span>
              {row.text}
            </li>
          ))}
        </ul>
      </div>

      <div className="session-actions">
        {summary?.moreAvailable ? (
          <Action
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void onMore().finally(() => setLoading(false));
            }}
            className="w-full lg:w-auto lg:flex-1"
          >
            {loading ? "Building" : "Do 5 more"}
          </Action>
        ) : null}
        <a href="/" className="session-primary w-full lg:w-auto lg:flex-1">
          Done
        </a>
      </div>
    </div>
  );
}
