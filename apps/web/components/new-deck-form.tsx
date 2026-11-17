"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// New deck, as the phone app has it: one box, like a chat composer.
//
// Type topics, paste a chapter, or attach a file and say what you want from it. The
// server decides what a document is for and asks only when it cannot tell, and shows
// what it understood before anything is written. There is no review step: once the
// first questions are written the deck opens.
//
// On a wide screen the box gets the room, and the choices sit beside it rather than
// under it.

import { useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileText,
  IdCard,
  ListChecks,
  Paperclip,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { apiClient, ApiRequestError, waitForJob } from "../lib/client";
import { soft, strong, type Hue } from "../lib/hue";
import { cx } from "./ui";

const LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const STYLES = [
  { value: "study", label: "Learning" },
  { value: "interview", label: "Interviews" },
  { value: "mixed", label: "Both" },
];

const INTENTS: {
  value: "study" | "topics" | "resume";
  label: string;
  detail: string;
  icon: typeof BookOpen;
  hue: Hue;
}[] = [
  {
    value: "study",
    label: "Questions on what it says",
    detail: "Check that you understood the material.",
    icon: BookOpen,
    hue: "blue",
  },
  {
    value: "topics",
    label: "Questions on the topics it lists",
    detail: "For a syllabus, a course outline or a job description.",
    icon: ListChecks,
    hue: "violet",
  },
  {
    value: "resume",
    label: "Interview prep from my resume",
    detail: "Questions about your own experience.",
    icon: IdCard,
    hue: "orange",
  },
];

const MAX_FILE = 10 * 1024 * 1024;

interface Preview {
  sourceId: string | null;
  title?: string;
  intent: string;
  reason?: string | null;
  scope?: string | null;
  topics?: string[];
  characters?: number;
  preview?: string;
  redactions?: { emails: number; phones: number };
  suspicious?: boolean;
  note?: string | null;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function NewDeckForm({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState("intermediate");
  const [style, setStyle] = useState("study");
  const [countPerTopic, setCountPerTopic] = useState(5);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choosingIntent, setChoosingIntent] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const isDocument = Boolean(file) || text.trim().length > 400;
  const topics = isDocument
    ? []
    : text
        .split(/[,\n]/)
        .map((topic) => topic.trim())
        .filter(Boolean)
        .slice(0, 10);
  const ready = isDocument || topics.length > 0;

  async function openDeckWhenWritten(jobId: string, sourceId: string): Promise<void> {
    setWorking("Writing questions");
    const status = await waitForJob(jobId, {
      onProgress: (job) => {
        if (job.type === "build_profile") setWorking("Reading your resume");
        else if (job.progress.total)
          setWorking(`Writing questions (${job.progress.done} of ${job.progress.total})`);
      },
    });
    if (status.status !== "done") {
      setError(
        status.status === "blocked"
          ? (status.blocked ?? "That needs credits to carry on.")
          : (status.error ?? "That did not finish."),
      );
      setWorking(null);
      return;
    }
    const { decks } = await apiClient.get<{ decks: { id: string; sourceId: string | null }[] }>(
      "/api/decks",
    );
    const deck = decks.find((candidate) => candidate.sourceId === sourceId);
    window.location.href = deck ? `/decks/${deck.id}` : "/decks";
  }

  async function readDocument(purpose: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { purpose, level, style, countPerTopic };
      if (file) {
        body["file"] = { name: file.name, contentType: file.type, base64: await toBase64(file) };
        if (text.trim()) body["instruction"] = text.trim();
      } else {
        body["text"] = text;
      }
      const result = await apiClient.post<Preview>("/api/question-sources/document", body);
      setPreview(result);
      setChoosingIntent(result.intent === "unclear" || !result.sourceId);
    } catch (thrown) {
      setError(
        thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!ready || busy) return;
    if (isDocument) return readDocument("auto");
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.post<{ sourceId: string; jobId: string }>(
        "/api/question-sources/topics",
        {
          topics,
          level,
          style,
          countPerTopic,
          ...(focus.trim() ? { extraContext: focus.trim() } : {}),
        },
      );
      await openDeckWhenWritten(result.jobId, result.sourceId);
    } catch (thrown) {
      setError(
        thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
      );
      setWorking(null);
    } finally {
      setBusy(false);
    }
  }

  async function writeFromPreview(): Promise<void> {
    if (!preview?.sourceId) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await apiClient.post<{ jobId: string }>(
        `/api/question-sources/${preview.sourceId}/generate`,
      );
      await openDeckWhenWritten(jobId, preview.sourceId);
    } catch (thrown) {
      setError(
        thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
      );
      setWorking(null);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="flex items-center gap-2">
      <a
        href="/decks"
        aria-label="Close"
        className="text-foreground hover:bg-quiet -ml-2 grid size-10 place-items-center rounded-full transition-colors"
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </a>
      <h1 className="font-display text-[22px] font-semibold lg:text-[30px]">New deck</h1>
    </div>
  );

  if (working) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-2 sm:px-6">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
          <span className="bg-primary-soft grid place-items-center rounded-[22px] p-[18px]">
            <Sparkles size={32} aria-hidden="true" />
          </span>
          <p className="font-display text-[22px] font-bold">{working}</p>
          <p className="text-muted-foreground text-[15px]">This takes a minute or two.</p>
          <span className="border-primary mt-2 size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      </main>
    );
  }

  if (preview && !choosingIntent) {
    const intent = INTENTS.find((item) => item.value === preview.intent) ?? INTENTS[0]!;
    const notes = [
      preview.redactions && (preview.redactions.emails > 0 || preview.redactions.phones > 0)
        ? `Removed ${preview.redactions.emails} email${preview.redactions.emails === 1 ? "" : "s"} and ${preview.redactions.phones} phone number${preview.redactions.phones === 1 ? "" : "s"} before anything goes to the AI.`
        : null,
      preview.note ?? null,
      (preview.characters ?? 0) >= 120_000
        ? "This is long, so aeyhey keeps the first part and works through it a slice at a time."
        : null,
    ].filter(Boolean);
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
        {header}
        <div className="mt-6 flex flex-col">
          <h2 className="text-lg font-semibold">{preview.title ?? "Your document"}</h2>
          <span
            className="mt-2.5 inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-bold"
            style={{ background: soft(intent.hue), color: strong(intent.hue) }}
          >
            <intent.icon size={13} aria-hidden="true" />
            {intent.label}
          </span>
          {preview.reason ? (
            <p className="text-muted-foreground mt-2.5 text-sm">{preview.reason}</p>
          ) : null}
          {preview.scope ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs">
              <Target size={15} aria-hidden="true" style={{ color: strong("green") }} />
              Stays within <strong>{preview.scope}</strong>
            </p>
          ) : null}
          {notes.map((note) => (
            <p
              key={note}
              className={cx(
                "mt-2 text-xs",
                preview.suspicious && preview.intent !== "topics"
                  ? "text-warning"
                  : "text-muted-foreground",
              )}
            >
              {note}
            </p>
          ))}
          {preview.intent === "topics" && preview.topics?.length ? (
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {preview.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full px-2.5 py-1 text-xs font-bold"
                  style={{ background: soft("violet"), color: strong("violet") }}
                >
                  {topic}
                </span>
              ))}
            </div>
          ) : preview.preview ? (
            <div className="bg-surface border-border mt-3.5 line-clamp-[12] whitespace-pre-wrap rounded-[22px] border p-3.5 text-xs">
              {preview.preview}
            </div>
          ) : null}
          {error ? <p className="text-danger mt-3 text-sm">{error}</p> : null}
          <div className="mt-[18px] flex flex-col gap-2.5 sm:flex-row">
            <SdkButton
              disabled={busy}
              onClick={() => void writeFromPreview()}
              className="session-primary sm:flex-1"
            >
              {preview.intent === "topics" && preview.topics?.length
                ? `Write ${preview.topics.length * countPerTopic} questions`
                : "Looks right, write questions"}
            </SdkButton>
            <SdkButton
              disabled={busy}
              onClick={() => setChoosingIntent(true)}
              className="quiet-pill session-quiet sm:flex-1"
            >
              Not what I meant
            </SdkButton>
          </div>
          <SdkButton
            onClick={() => setPreview(null)}
            className="text-primary mt-3 self-center text-sm font-semibold"
          >
            Go back
          </SdkButton>
        </div>
      </main>
    );
  }

  if (preview && choosingIntent) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
        {header}
        <h2 className="mt-6 text-lg font-semibold">What would you like from it?</h2>
        <p className="text-muted-foreground mt-1 text-sm">{preview.reason ?? preview.title}</p>
        <ul className="mt-3.5 flex flex-col gap-2">
          {INTENTS.map((intent) => (
            <li key={intent.value}>
              <SdkButton
                disabled={busy}
                onClick={() => void readDocument(intent.value)}
                className="bg-sunken hover:bg-quiet flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-[11px]"
                  style={{ background: soft(intent.hue), color: strong(intent.hue) }}
                >
                  <intent.icon size={18} aria-hidden="true" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-sm font-semibold">{intent.label}</span>
                  <span className="text-muted-foreground text-xs">{intent.detail}</span>
                </span>
                {preview.intent === intent.value ? (
                  <Check size={18} aria-hidden="true" className="text-primary" />
                ) : null}
              </SdkButton>
            </li>
          ))}
        </ul>
        {error ? <p className="text-danger mt-3 text-sm">{error}</p> : null}
        <SdkButton
          onClick={() => setPreview(null)}
          className="text-primary mt-4 text-sm font-semibold"
        >
          Go back
        </SdkButton>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-2 sm:px-6 lg:px-8">
      {header}
      {error ? <p className="text-danger mt-3 text-sm">{error}</p> : null}

      <form
        className="mt-4 grid gap-x-12 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <div className="composer flex flex-col rounded-[20px] pb-2 pl-3.5 pr-2 pt-1.5">
            <label htmlFor="deck-text" className="sr-only">
              What do you want to learn?
            </label>
            <textarea
              id="deck-text"
              autoFocus
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                file ? "What do you want from it? (optional)" : "What do you want to learn?"
              }
              className="placeholder:text-subtle-foreground field-sizing-content max-h-[50dvh] min-h-24 resize-none bg-transparent py-2 text-[14.5px] leading-[1.45] outline-none lg:min-h-40 lg:text-base"
            />
            {file ? (
              <div className="bg-surface border-border mr-1.5 mt-1 flex items-center gap-2.5 rounded-[14px] border py-2 pl-2 pr-1">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-[10px]"
                  style={{ background: soft("blue"), color: strong("blue") }}
                >
                  <FileText size={16} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{file.name}</span>
                  <span className="text-muted-foreground text-xs">{sizeLabel(file.size)}</span>
                </span>
                <SdkButton
                  aria-label="Remove file"
                  onClick={() => setFile(null)}
                  className="text-muted-foreground hover:bg-quiet grid size-8 place-items-center rounded-full"
                >
                  <X size={16} aria-hidden="true" />
                </SdkButton>
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center">
              <SdkButton
                onClick={() => fileInput.current?.click()}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] font-semibold"
              >
                <Paperclip size={16} aria-hidden="true" />
                {file ? "Change file" : "Attach a file"}
              </SdkButton>
              <span className="text-subtle-foreground ml-auto text-xs">PDF, Word or text</span>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  if (!picked) return;
                  if (picked.size > MAX_FILE) {
                    setError(
                      "That file is over 10 MB. Try a smaller part of it, or paste the text.",
                    );
                    return;
                  }
                  setError(null);
                  setFile(picked);
                }}
              />
            </div>
          </div>
          <p className="text-muted-foreground px-1 pt-2 text-xs">
            {file
              ? "Say what you want from it, or leave it blank and aeyhey works it out."
              : isDocument
                ? "That is long, so it will be read as a document."
                : "Separate topics with commas, up to 10. Or attach a book, notes, a syllabus or your resume."}
          </p>
        </div>

        <div className="flex flex-col">
          <Choice label="Level" value={level} onChange={setLevel} options={LEVELS} />
          <Choice label="Questions for" value={style} onChange={setStyle} options={STYLES} />
          {isDocument ? null : (
            <>
              <label className="pb-2 pt-[18px] text-[13.5px] font-semibold" htmlFor="per-topic">
                {countPerTopic} questions per topic
              </label>
              <input
                id="per-topic"
                type="range"
                min={1}
                max={20}
                step={1}
                value={countPerTopic}
                onChange={(event) => setCountPerTopic(Number(event.target.value))}
                className="accent-[var(--color-primary)]"
              />
              <label className="pb-2 pt-[18px] text-[13.5px] font-semibold" htmlFor="focus">
                Anything to focus on? (optional)
              </label>
              <textarea
                id="focus"
                rows={2}
                maxLength={1000}
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                placeholder="Key dates and people, or the formulas"
                className="link-field text-sm!"
              />
            </>
          )}
          <SdkButton type="submit" disabled={!ready || busy} className="session-primary mt-4">
            {busy
              ? "Reading"
              : isDocument || topics.length === 0
                ? "Continue"
                : `Write ${topics.length * countPerTopic} questions`}
          </SdkButton>
        </div>
      </form>
    </main>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <>
      <p className="pb-2 pt-[18px] text-[13.5px] font-semibold lg:pt-0 [&:not(:first-child)]:lg:pt-[18px]">
        {label}
      </p>
      <SegmentedControl
        aria-label={label}
        value={value}
        onValueChange={(next) => next && onChange(next)}
        className="pill-segments"
      >
        <SegmentedControlIndicator />
        {options.map((option) => (
          <SegmentedControlItem key={option.value} value={option.value}>
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </>
  );
}
