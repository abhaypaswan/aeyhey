"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// One deck, as the phone app has it.
//
// Nobody writes questions here: Aeyhey writes new ones before each reminder, so the page
// says when. Each topic takes a few words of details that every later batch follows. The
// deck sits at the top as the same stack the list draws, larger. Each question is the
// front of a card, and opening it turns it over to the model answer and key points.
//
// On a wide screen the deck itself (its numbers, what comes next, its topics) stays in a
// column on the left while the questions scroll on the right.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Ellipsis,
  Pause,
  Play,
  Repeat2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { apiClient, ApiRequestError } from "../lib/client";
import { hueFor, mix, strong, type Hue } from "../lib/hue";
import { ConfirmButton } from "./confirm";
import { DashedCard, DeckStack, DifficultyMark } from "./drawings";
import { LinkButton, cx } from "./ui";

interface DeckQuestion {
  id: string;
  text: string;
  modelAnswer: string;
  keyPoints: string[];
  difficulty: string;
  tags: string[];
  state: "new" | "due" | "learning" | "learned" | null;
  timesAsked: number;
  lastAnswer: { text: string; verdict: "correct" | "partial" | "incorrect" } | null;
}

interface DeckFacts {
  id: string;
  name: string;
  kind: string;
  paused: boolean;
  writes: boolean;
  remindersOn: boolean;
  nextQuestionsLabel: string | null;
  total: number;
  due: number;
  dueNew: number;
  dueReview: number;
  learned: number;
  unasked: number;
}

const SOURCE: Record<string, string> = {
  resume: "From your resume",
  document: "From a document",
  manual: "Written by you",
};

const TABS = [
  { value: "all", label: "All" },
  { value: "due", label: "Due" },
  { value: "learning", label: "Learning" },
  { value: "learned", label: "Learned" },
] as const;

const EMPTY_TAB: Record<string, string> = {
  due: "Nothing is due. New questions arrive with your next reminder.",
  learning: "Nothing in between. Questions you have answered, and are not learned yet, show here.",
  learned:
    "Nothing learned yet. A question counts as learned once Aeyhey spaces it three weeks or more apart, after a few good answers.",
};

const VERDICT: Record<string, { word: string; color: string }> = {
  correct: { word: "Right", color: "var(--color-success)" },
  incorrect: { word: "Missed", color: "var(--color-danger)" },
  partial: { word: "Partly right", color: "var(--color-warning)" },
};

const DECK_HUES: Hue[] = ["orange", "blue", "violet", "green", "pink", "teal"];

export function DeckDetail({
  deck,
  topics,
  questions,
}: {
  deck: DeckFacts;
  topics: { name: string; details: string | null }[];
  questions: DeckQuestion[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(questions);
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("all");
  const [name, setName] = useState(deck.name);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const hue = hueFor(deck.id);

  async function run(work: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ text: done });
      router.refresh();
      return true;
    } catch (thrown) {
      setMessage({
        text:
          thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
        error: true,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: Record<string, unknown>) => () =>
    apiClient.patch(`/api/decks/${deck.id}`, body);

  async function rename(): Promise<void> {
    const next = name.trim();
    if (next === "" || next === deck.name) {
      setName(deck.name);
      setRenaming(false);
      return;
    }
    if (await run(patch({ name: next }), "Deck renamed.")) setRenaming(false);
  }

  async function removeQuestion(id: string): Promise<void> {
    if (await run(() => apiClient.delete(`/api/questions/${id}`), "Question removed.")) {
      setItems((current) => current.filter((item) => item.id !== id));
    }
  }

  async function deleteDeck(): Promise<void> {
    setBusy(true);
    try {
      await apiClient.delete(`/api/decks/${deck.id}`);
      window.location.href = "/decks";
    } catch (thrown) {
      setMessage({
        text:
          thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
        error: true,
      });
      setBusy(false);
    }
  }

  const counts = {
    all: items.length,
    due: items.filter((item) => item.state === "due" || item.state === "new").length,
    learning: items.filter((item) => item.state === "learning").length,
    learned: items.filter((item) => item.state === "learned").length,
  };
  const shown = items.filter((item) =>
    tab === "all"
      ? true
      : tab === "due"
        ? item.state === "due" || item.state === "new"
        : item.state === tab,
  );

  const progressLine =
    deck.total === 0
      ? "No questions yet"
      : deck.learned === 0
        ? deck.total === 1
          ? "1 question"
          : `${deck.total} questions, none learned yet`
        : deck.learned === deck.total
          ? `All ${deck.total} questions learned`
          : `${deck.learned} of ${deck.total} learned`;

  const big = deck.due > 0 ? deck.due : deck.total;
  const bigWord = deck.due > 0 ? "due now" : deck.total === 1 ? "question" : "questions";

  return (
    <main className="mx-auto w-full max-w-6xl px-[22px] pb-16 pt-2 sm:px-6 lg:px-8 lg:pt-6">
      <div className="flex items-center justify-between">
        <a
          href="/decks"
          className="text-foreground hover:bg-quiet -ml-2 flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={20} aria-hidden="true" />
          <span className="hidden lg:inline">Decks</span>
        </a>
        <Menu>
          <MenuTrigger
            aria-label="More"
            className="text-foreground hover:bg-quiet grid size-10 place-items-center rounded-full transition-colors"
          >
            <Ellipsis size={20} aria-hidden="true" />
          </MenuTrigger>
          <MenuContent align="end" className="later-menu min-w-44">
            <MenuItem onSelect={() => setRenaming(true)}>Rename deck</MenuItem>
            <MenuItem
              onSelect={() =>
                void run(
                  patch({ paused: !deck.paused }),
                  deck.paused
                    ? "Deck resumed. Its questions come back in your sessions."
                    : "Deck paused. Its questions are kept.",
                )
              }
            >
              {deck.paused ? "Resume deck" : "Pause deck"}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {message ? (
        <p
          role="status"
          className={cx("mt-1 text-sm", message.error ? "text-danger" : "text-muted-foreground")}
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-x-16 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="mt-1 flex items-start gap-5">
            <DeckStack
              id={deck.id}
              kind={deck.kind}
              total={deck.total}
              learned={deck.learned}
              scale={1.6}
            />
            <div className="flex min-w-0 flex-col pt-1">
              <p style={{ color: deck.due > 0 ? "var(--color-primary)" : undefined }}>
                <span className="font-display text-4xl font-[640] leading-none">{big}</span>
                <span className="ml-2 text-base font-semibold">{bigWord}</span>
              </p>
              {deck.due > 0 ? (
                <p className="mt-2 text-[14.5px]">
                  {deck.dueNew} new, {deck.dueReview} to review
                </p>
              ) : null}
              <p className="text-muted-foreground text-[14.5px]">{progressLine}</p>
            </div>
          </div>

          <p className="text-muted-foreground mt-[18px] text-[13.5px]">
            {SOURCE[deck.kind] ?? "From topics"}
          </p>
          {renaming ? (
            <form
              className="mt-1"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setName(deck.name);
                    setRenaming(false);
                  }
                }}
                aria-label="Deck name"
                className="link-field font-display text-[26px]! font-semibold"
              />
            </form>
          ) : (
            <h1 className="mt-1">
              <SdkButton
                onClick={() => setRenaming(true)}
                title="Rename deck"
                className="font-display text-left text-[28px] font-semibold leading-[1.14] tracking-[-0.01em] hover:underline hover:decoration-[color:var(--color-border-strong)] lg:text-[32px]"
              >
                {name}
              </SdkButton>
            </h1>
          )}

          {deck.due > 0 && !deck.paused ? (
            <div className="mt-5 hidden lg:block">
              <LinkButton href="/session" tone="primary" icon={Play} className="home-cta">
                Start a session
              </LinkButton>
            </div>
          ) : null}

          {deck.paused ? (
            <div className="bg-surface border-border mt-[22px] flex gap-3.5 rounded-[14px] border px-3.5 pb-3 pt-4">
              <Pause size={20} aria-hidden="true" className="text-muted-foreground shrink-0" />
              <div className="flex flex-col gap-1">
                <p className="font-display text-lg font-semibold">This deck is paused</p>
                <p className="text-muted-foreground text-[13px]">
                  Its questions are kept but not asked, and no new ones are written.
                </p>
                <div className="mt-2">
                  <SdkButton
                    disabled={busy}
                    onClick={() =>
                      void run(
                        patch({ paused: false }),
                        "Deck resumed. Its questions come back in your sessions.",
                      )
                    }
                    className="session-primary min-h-10!"
                  >
                    Resume
                  </SdkButton>
                </div>
              </div>
            </div>
          ) : deck.writes ? (
            <ComingNext deck={deck} />
          ) : null}

          {topics.length > 0 ? (
            <section aria-label="Topics" className="mt-[30px]">
              <h2 className="font-display text-[17px] font-[640] tracking-[-0.006em]">Topics</h2>
              <p className="text-muted-foreground mt-0.5 text-sm leading-[1.4]">
                A few words on each, such as your level or what to focus on, shape every new
                question.
              </p>
              <ul className="mt-1.5">
                {topics.map((topic, index) => (
                  <TopicRow
                    key={topic.name}
                    deckId={deck.id}
                    topic={topic}
                    hue={DECK_HUES[(DECK_HUES.indexOf(hue) + index) % DECK_HUES.length] ?? hue}
                    first={index === 0}
                    run={run}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-8 hidden lg:block">
            <ConfirmButton
              label={
                <span className="flex items-center gap-2">
                  <Trash2 size={15} aria-hidden="true" />
                  Delete deck
                </span>
              }
              triggerClassName="text-muted-foreground hover:text-danger text-sm font-medium"
              title={`Delete "${deck.name}"?`}
              description={`Its questions and their history go too.${
                deck.paused
                  ? ""
                  : " To stop getting its questions for a while instead, pause the deck."
              }`}
              confirmLabel="Delete"
              cancelLabel="Cancel"
              disabled={busy}
              onConfirm={() => void deleteDeck()}
            />
          </div>
        </aside>

        <section aria-label="Questions" className="mt-[30px] min-w-0 lg:mt-1">
          <h2 className="font-display text-[17px] font-[640] tracking-[-0.006em] lg:text-xl">
            Questions
          </h2>
          {items.length === 0 ? (
            <div className="pt-[30px]">
              <p className="font-display text-[19px] font-semibold">No questions yet</p>
              <p className="text-muted-foreground mt-1.5 text-[15px]">
                Aeyhey writes the first ones in a moment and more before each reminder. Reload the
                page to check again.
              </p>
            </div>
          ) : (
            <>
              <nav
                aria-label="Filter questions"
                className="border-border mt-1 flex h-10 items-stretch overflow-x-auto border-b-[0.5px] [scrollbar-width:none]"
              >
                {TABS.map((option) => (
                  <SdkButton
                    key={option.value}
                    aria-pressed={tab === option.value}
                    onClick={() => setTab(option.value)}
                    className={cx(
                      "relative flex shrink-0 items-center pr-[18px] text-[14.5px]",
                      tab === option.value
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground",
                    )}
                  >
                    {option.label}
                    <span className="text-subtle-foreground ml-2 font-normal">
                      {counts[option.value]}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cx(
                        "absolute bottom-0 left-0 right-[18px] h-0.5 rounded-sm",
                        tab === option.value ? "bg-primary" : "bg-transparent",
                      )}
                    />
                  </SdkButton>
                ))}
              </nav>
              {shown.length === 0 ? (
                <p className="text-muted-foreground pt-[22px] text-[15px]">{EMPTY_TAB[tab]}</p>
              ) : (
                <ul>
                  {shown.map((question, index) => (
                    <QuestionRow
                      key={question.id}
                      question={question}
                      hue={hue}
                      first={index === 0}
                      busy={busy}
                      onRemove={() => void removeQuestion(question.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="mt-10 lg:hidden">
            <ConfirmButton
              label={
                <span className="flex items-center gap-2">
                  <Trash2 size={15} aria-hidden="true" />
                  Delete deck
                </span>
              }
              triggerClassName="text-muted-foreground hover:text-danger text-sm font-medium"
              title={`Delete "${deck.name}"?`}
              description={`Its questions and their history go too.${
                deck.paused
                  ? ""
                  : " To stop getting its questions for a while instead, pause the deck."
              }`}
              confirmLabel="Delete"
              cancelLabel="Cancel"
              disabled={busy}
              onConfirm={() => void deleteDeck()}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

/** When the next new questions come, with the three dashed cards drawn coming in. */
function ComingNext({ deck }: { deck: DeckFacts }) {
  const on = deck.remindersOn;
  const ink = on ? "var(--color-primary)" : "var(--color-muted-foreground)";
  const big = !on
    ? "Turn reminders on in Settings"
    : deck.unasked > 0
      ? deck.unasked === 1
        ? "After the new one here"
        : `After the ${deck.unasked} new ones here`
      : (deck.nextQuestionsLabel ?? "Soon");
  return (
    <div
      className="mt-[22px] flex items-center gap-3.5 rounded-[14px] border py-3.5 pl-3.5 pr-4"
      style={
        on
          ? {
              background: mix("var(--color-canvas)", "var(--color-primary)", 0.06, 0.12),
              borderColor: mix("var(--color-canvas)", "var(--color-primary)", 0.18, 0.3),
            }
          : { background: "var(--color-surface)", borderColor: "var(--color-border)" }
      }
    >
      <span aria-hidden="true" className="relative block h-[50px] w-[52px] shrink-0">
        {[-9, 0, 9].map((x, index) => (
          <span
            key={x}
            className="absolute left-1/2 top-1/2"
            style={{
              transform: `translate(calc(-50% + ${x}px), -50%) rotate(${(index - 1) * 12.6}deg)`,
              opacity: [0.45, 0.7, 0.95][index],
            }}
          >
            <DashedCard color={ink} width={28} height={38}>
              {index === 2 ? <Sparkles size={14} /> : null}
            </DashedCard>
          </span>
        ))}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground text-[13px]">
          {on ? "Next new questions" : "New questions are paused"}
        </span>
        <span className="font-display text-lg font-semibold leading-snug">{big}</span>
        {on ? (
          <span className="text-muted-foreground text-[13px] leading-[1.35]">
            {deck.unasked > 0
              ? "Aeyhey writes more once every question in this deck has been asked"
              : "Written for this deck and sent with your reminder"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TopicRow({
  deckId,
  topic,
  hue,
  first,
  run,
}: {
  deckId: string;
  topic: { name: string; details: string | null };
  hue: Hue;
  first: boolean;
  run: (work: () => Promise<unknown>, done: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(topic.details ?? "");

  async function save(): Promise<void> {
    const text = details.trim();
    const ok = await run(
      () => apiClient.patch(`/api/decks/${deckId}`, { topicDetails: { [topic.name]: text } }),
      text === "" ? "Details cleared." : `Saved. New questions on ${topic.name} will follow it.`,
    );
    if (ok) setEditing(false);
  }

  return (
    <li className={cx("flex gap-3 py-3.5", !first && "border-border border-t-[0.5px]")}>
      <span
        aria-hidden="true"
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ background: strong(hue) }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="font-display text-[16.5px] font-[580] leading-[1.25]">{topic.name}</span>
        {editing ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="What it is for, your level, what to focus on or leave out. For example: class 11 mechanics, with numericals in SI units."
              className="link-field text-sm!"
            />
            <div className="flex gap-2">
              <SdkButton type="submit" className="session-primary min-h-9! px-4! text-sm!">
                Save
              </SdkButton>
              <SdkButton onClick={() => setEditing(false)} className="quiet-pill h-9!">
                Cancel
              </SdkButton>
            </div>
          </form>
        ) : topic.details ? (
          <span className="text-muted-foreground line-clamp-3 text-sm leading-[1.4]">
            {topic.details}
          </span>
        ) : (
          <span className="text-subtle-foreground text-sm">No details yet</span>
        )}
      </div>
      {editing ? null : (
        <SdkButton
          onClick={() => setEditing(true)}
          className="text-primary shrink-0 self-start text-sm font-semibold"
        >
          {topic.details ? "Edit" : "Add"}
        </SdkButton>
      )}
    </li>
  );
}

function QuestionRow({
  question,
  hue,
  first,
  busy,
  onRemove,
}: {
  question: DeckQuestion;
  hue: Hue;
  first: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = question.lastAnswer ? VERDICT[question.lastAnswer.verdict] : null;
  const stateWord =
    question.state === "new" ? "New" : question.state === "due" ? "Due again" : null;

  return (
    <li className={cx(!first && "border-border border-t-[0.5px]")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-start gap-3 py-4 text-left">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-display text-[17.5px] font-[520] leading-[1.3]">
              {question.text}
            </span>
            {!open && question.lastAnswer && verdict ? (
              <span className="mt-2.5">
                <LastAnswer answer={question.lastAnswer} verdict={verdict} clamp />
              </span>
            ) : null}
            <span className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px]">
              {question.state === "learned" ? (
                <span
                  className="flex items-center gap-1 font-semibold"
                  style={{ color: "var(--color-success)" }}
                >
                  <Check size={14} aria-hidden="true" />
                  Learned
                </span>
              ) : stateWord ? (
                <span className="text-primary font-semibold">{stateWord}</span>
              ) : null}
              {question.timesAsked > 0 ? (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Repeat2 size={13} aria-hidden="true" />
                  {question.timesAsked === 1 ? "Asked once" : `Asked ${question.timesAsked} times`}
                </span>
              ) : null}
              <DifficultyMark level={question.difficulty} />
              {question.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </span>
          </span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={cx(
              "text-muted-foreground mt-1 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div
            className="mb-3.5 flex flex-col rounded-[10px] border px-4 pb-1 pt-3.5"
            style={{
              background: mix("var(--color-canvas)", strong(hue), 0.05, 0.1),
              borderColor: mix("var(--color-canvas)", strong(hue), 0.2, 0.3),
            }}
          >
            {question.lastAnswer && verdict ? (
              <div className="mb-4">
                <LastAnswer answer={question.lastAnswer} verdict={verdict} />
              </div>
            ) : question.timesAsked > 0 ? (
              <p className="text-muted-foreground mb-4 text-[13.5px]">
                No written answer from last time
              </p>
            ) : null}
            <p className="font-display text-[14.5px] font-[620]" style={{ color: strong(hue) }}>
              Model answer
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-[1.5]">
              {question.modelAnswer || "No model answer for this one."}
            </p>
            {question.keyPoints.length > 0 ? (
              <>
                <p
                  className="font-display mt-4 text-[14.5px] font-[620]"
                  style={{ color: strong(hue) }}
                >
                  A good answer covers
                </p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {question.keyPoints.map((point, index) => (
                    <li key={index} className="flex gap-2 text-[14.5px] leading-[1.4]">
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                        style={{ color: strong(hue) }}
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="flex justify-end">
              <ConfirmButton
                label={
                  <span className="flex items-center gap-1.5">
                    <Trash2 size={16} aria-hidden="true" />
                    Remove question
                  </span>
                }
                triggerClassName="text-muted-foreground hover:text-danger my-1 rounded-full px-2 py-2 text-sm font-medium"
                title="Remove this question?"
                description="It stops coming up, and Aeyhey will not ask it again."
                confirmLabel="Remove"
                cancelLabel="Cancel"
                disabled={busy}
                onConfirm={onRemove}
              />
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

function LastAnswer({
  answer,
  verdict,
  clamp,
}: {
  answer: { text: string };
  verdict: { word: string; color: string };
  clamp?: boolean;
}) {
  return (
    <span className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="w-[3px] shrink-0 rounded-sm"
        style={{ background: verdict.color }}
      />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-muted-foreground text-[12.5px]">
          Your last answer{"  "}
          <span className="font-semibold" style={{ color: verdict.color }}>
            {verdict.word}
          </span>
        </span>
        <span className={cx("text-[14.5px] leading-[1.45]", clamp && "line-clamp-2")}>
          {answer.text}
        </span>
      </span>
    </span>
  );
}
