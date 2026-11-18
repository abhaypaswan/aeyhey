"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The assistant: the one place to add anything to Aeyhey, or ask about it.
//
// Paste links, name topics, attach a book, notes or a resume, or ask a question about
// what you saved. The server (POST /api/assistant) works out which; this side holds the
// conversation and runs the steps that take a while, saying what it is doing as it goes:
// a deck is proposed, then written once agreed, with its progress, and then opened; a
// document is read, its reading shown back, and questions written only once it is right.
//
// The conversation is kept for this tab, so leaving Home and coming back keeps it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  FileText,
  IdCard,
  Link2,
  ListChecks,
  Paperclip,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { apiClient, ApiRequestError, waitForJob } from "../lib/client";
import { soft, strong, type Hue } from "../lib/hue";
import { cx } from "./ui";

// ------------------------------------------------------------------------- shapes

interface Proposal {
  topics: string[];
  level: "beginner" | "intermediate" | "advanced";
  style: "study" | "interview" | "mixed";
  countPerTopic: number;
}

interface Source {
  id: string;
  kind: "link" | "question";
  title: string;
  href: string;
}

interface Option {
  label: string;
  message: string;
  force: "make_deck" | "ask";
}

interface AssistantReply {
  intent: "save_links" | "make_deck" | "ask" | "help" | "unclear";
  reply: string;
  saved?: { created: number; duplicates: number };
  proposal?: Proposal;
  answer?: { found: boolean; sources: Source[] };
  options?: Option[];
}

interface DocumentPreview {
  sourceId: string | null;
  title?: string;
  intent: string;
  reason?: string | null;
  scope?: string | null;
  topics?: string[];
}

type Message =
  | { id: string; role: "user"; text: string; fileName?: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      /** What it is doing right now, such as "Writing questions (3 of 15)". */
      working?: string;
      proposal?: Proposal;
      /** Set once a proposal or a document has been acted on, so its buttons go. */
      settled?: boolean;
      document?: DocumentPreview & { fileKey: string };
      sources?: Source[];
      options?: Option[];
      links?: { label: string; href: string }[];
      error?: boolean;
    };

const STORAGE_KEY = "aeyhey:assistant";
const LEVELS: Proposal["level"][] = ["beginner", "intermediate", "advanced"];
const STYLES: { value: Proposal["style"]; label: string }[] = [
  { value: "study", label: "Learning" },
  { value: "interview", label: "Interviews" },
  { value: "mixed", label: "Both" },
];
const INTENTS: {
  value: "study" | "topics" | "resume";
  label: string;
  icon: typeof BookOpen;
  hue: Hue;
}[] = [
  { value: "study", label: "Questions on what it says", icon: BookOpen, hue: "blue" },
  { value: "topics", label: "Questions on the topics it lists", icon: ListChecks, hue: "violet" },
  { value: "resume", label: "Interview prep from my resume", icon: IdCard, hue: "orange" },
];
const EXAMPLES: { label: string; text?: string; attach?: boolean; icon: typeof Link2 }[] = [
  { label: "Paste a link", text: "https://", icon: Link2 },
  {
    label: "The solar system, stars and black holes",
    text: "The solar system, stars and black holes",
    icon: Brain,
  },
  { label: "Attach a book, notes or resume", attach: true, icon: Paperclip },
  {
    label: "What did I save about black holes?",
    text: "What did I save about black holes?",
    icon: Sparkles,
  },
];
const MAX_FILE = 10 * 1024 * 1024;

let counter = 0;
const newId = (): string => `${Date.now().toString(36)}-${(counter += 1)}`;

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function errorText(thrown: unknown): string {
  return thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.";
}

// ----------------------------------------------------------------------- component

export function Assistant({
  initialText = "",
  className,
}: {
  initialText?: string;
  className?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialText);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // Nothing is saved until what was stored has been read back, or the empty first render
  // would overwrite the conversation before it is restored.
  const [restored, setRestored] = useState(false);
  const files = useRef(new Map<string, File>());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // The conversation is kept for this tab only; work that was in progress is not resumed.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        setMessages(
          parsed.map((m) =>
            m.role === "assistant" && m.working ? { ...m, working: undefined, settled: true } : m,
          ),
        );
      }
    } catch {
      // A private window or blocked storage: start empty.
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      // Not being able to remember the conversation is fine.
    }
  }, [messages, restored]);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (initialText) box.current?.focus();
  }, [initialText]);

  const push = useCallback((message: Message) => setMessages((list) => [...list, message]), []);
  const update = useCallback(
    (id: string, patch: Partial<Extract<Message, { role: "assistant" }>>) =>
      setMessages((list) =>
        list.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...patch } : m)),
      ),
    [],
  );

  // ------------------------------------------------------------- writing a deck

  const openDeckWhenWritten = useCallback(
    async (messageId: string, jobId: string, sourceId: string, what: string) => {
      update(messageId, { working: "Writing questions", settled: true });
      const status = await waitForJob(jobId, {
        onProgress: (job) => {
          if (job.type === "build_profile") update(messageId, { working: "Reading your resume" });
          else if (job.progress.total)
            update(messageId, {
              working: `Writing questions (${job.progress.done} of ${job.progress.total})`,
            });
        },
      });
      if (status.status !== "done") {
        update(messageId, { working: undefined });
        push({
          id: newId(),
          role: "assistant",
          error: true,
          text:
            status.status === "blocked"
              ? (status.blocked ?? "That needs credits to carry on.")
              : (status.error ?? "That did not finish. Try again in a moment."),
        });
        return;
      }
      const { decks } = await apiClient.get<{
        decks: { id: string; sourceId: string | null; name: string; counts: { total: number } }[];
      }>("/api/decks");
      const deck = decks.find((candidate) => candidate.sourceId === sourceId);
      update(messageId, { working: undefined });
      push({
        id: newId(),
        role: "assistant",
        text: deck
          ? `Done. ${deck.counts.total} questions on ${what} are ready, and they will come up in your sessions.`
          : "Done. Your questions are ready.",
        links: [{ label: "Open the deck", href: deck ? `/decks/${deck.id}` : "/decks" }],
      });
      router.refresh();
    },
    [push, update, router],
  );

  const makeDeck = useCallback(
    async (messageId: string, proposal: Proposal) => {
      setBusy(true);
      update(messageId, { settled: true, working: "Setting it up" });
      try {
        const result = await apiClient.post<{ sourceId: string; jobId: string }>(
          "/api/question-sources/topics",
          proposal,
        );
        const what =
          proposal.topics.length <= 3
            ? proposal.topics.join(", ")
            : `${proposal.topics.slice(0, 2).join(", ")} and ${proposal.topics.length - 2} more`;
        await openDeckWhenWritten(messageId, result.jobId, result.sourceId, what);
      } catch (thrown) {
        update(messageId, { working: undefined, settled: false });
        push({ id: newId(), role: "assistant", error: true, text: errorText(thrown) });
      } finally {
        setBusy(false);
      }
    },
    [push, update, openDeckWhenWritten],
  );

  // ---------------------------------------------------------- reading a document

  const readDocument = useCallback(
    async (
      fileKey: string,
      source: { file?: File; text?: string },
      instruction: string,
      purpose: string,
    ) => {
      const messageId = newId();
      push({
        id: messageId,
        role: "assistant",
        text: "",
        working: source.file ? `Reading ${source.file.name}` : "Reading what you pasted",
      });
      setBusy(true);
      try {
        const body: Record<string, unknown> = {
          purpose,
          level: "intermediate",
          style: "study",
          countPerTopic: 5,
        };
        if (source.file) {
          body["file"] = {
            name: source.file.name,
            contentType: source.file.type,
            base64: await toBase64(source.file),
          };
          if (instruction) body["instruction"] = instruction;
        } else {
          body["text"] = source.text;
        }
        const preview = await apiClient.post<DocumentPreview>(
          "/api/question-sources/document",
          body,
        );
        const unclear = preview.intent === "unclear" || !preview.sourceId;
        const intent = INTENTS.find((item) => item.value === preview.intent);
        update(messageId, {
          working: undefined,
          text: unclear
            ? "I am not sure what you would like from this one. Which is it?"
            : [
                preview.reason,
                preview.scope ? `I will keep the questions within ${preview.scope}.` : null,
              ]
                .filter(Boolean)
                .join(" ") || `I will make ${intent?.label.toLowerCase() ?? "questions"}.`,
          document: { ...preview, fileKey },
        });
      } catch (thrown) {
        update(messageId, { working: undefined, error: true, text: errorText(thrown) });
      } finally {
        setBusy(false);
      }
    },
    [push, update],
  );

  const writeFromDocument = useCallback(
    async (messageId: string, preview: DocumentPreview) => {
      if (!preview.sourceId) return;
      setBusy(true);
      update(messageId, { settled: true, working: "Setting it up" });
      try {
        const { jobId } = await apiClient.post<{ jobId: string }>(
          `/api/question-sources/${preview.sourceId}/generate`,
        );
        await openDeckWhenWritten(
          messageId,
          jobId,
          preview.sourceId,
          preview.title ?? "your document",
        );
      } catch (thrown) {
        update(messageId, { working: undefined, settled: false });
        push({ id: newId(), role: "assistant", error: true, text: errorText(thrown) });
      } finally {
        setBusy(false);
      }
    },
    [push, update, openDeckWhenWritten],
  );

  // --------------------------------------------------------------------- sending

  const send = useCallback(
    async (text: string, options: { force?: Option["force"]; shown?: string } = {}) => {
      const message = text.trim();
      if ((message === "" && !file) || busy) return;

      const attached = file;
      setDraft("");
      setFile(null);
      push({
        id: newId(),
        role: "user",
        text: options.shown ?? message,
        ...(attached ? { fileName: attached.name } : {}),
      });

      // A file, or a long paste with no links in it, is a document to read.
      const hasLink = /https?:\/\/\S+|www\.\S+\.\S+/i.test(message);
      if (attached || (!options.force && !hasLink && message.length > 400)) {
        const fileKey = newId();
        if (attached) files.current.set(fileKey, attached);
        await readDocument(
          fileKey,
          attached ? { file: attached } : { text: message },
          attached ? message : "",
          "auto",
        );
        return;
      }

      const history = messages
        .filter((m) => m.text)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 500) }));
      const replyId = newId();
      push({ id: replyId, role: "assistant", text: "", working: "Thinking" });
      setBusy(true);
      try {
        const reply = await apiClient.post<AssistantReply>("/api/assistant", {
          message,
          ...(options.force ? { force: options.force } : {}),
          history,
        });
        update(replyId, {
          working: undefined,
          text: reply.reply,
          ...(reply.proposal ? { proposal: reply.proposal } : {}),
          ...(reply.answer?.sources.length ? { sources: reply.answer.sources } : {}),
          ...(reply.options?.length ? { options: reply.options } : {}),
          ...(reply.saved && reply.saved.created > 0
            ? { links: [{ label: "Open Inbox", href: "/inbox" }] }
            : {}),
        });
        if (reply.saved && reply.saved.created > 0) router.refresh();
      } catch (thrown) {
        update(replyId, { working: undefined, error: true, text: errorText(thrown) });
      } finally {
        setBusy(false);
      }
    },
    [busy, file, messages, push, update, readDocument, router],
  );

  const clear = (): void => {
    setMessages([]);
    files.current.clear();
  };

  // ---------------------------------------------------------------------- drawing

  return (
    <section
      aria-label="Assistant"
      className={cx(
        "assistant-panel flex min-h-0 flex-col overflow-hidden rounded-[22px]",
        className,
      )}
    >
      <header className="border-border flex items-center gap-2.5 border-b-[0.5px] px-4 py-3">
        <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-full">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-[640] leading-tight">Assistant</h2>
          <p className="text-muted-foreground truncate text-xs">
            Add anything, or ask about what you saved
          </p>
        </div>
        {messages.length > 0 ? (
          <SdkButton
            onClick={clear}
            disabled={busy}
            aria-label="Start a new conversation"
            title="New conversation"
            className="text-muted-foreground hover:bg-quiet hover:text-foreground grid size-8 place-items-center rounded-full"
          >
            <RotateCcw size={15} aria-hidden="true" />
          </SdkButton>
        ) : null}
      </header>

      <div
        ref={thread}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] leading-[1.45]">
              Paste a link you want to read, name what you want to learn, attach a book, your notes
              or your resume, or ask about anything you have saved. I will work out the rest.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <SdkButton
                  key={example.label}
                  onClick={() => {
                    if (example.attach) fileInput.current?.click();
                    else {
                      setDraft(example.text ?? "");
                      box.current?.focus();
                    }
                  }}
                  className="quiet-chip gap-1.5"
                >
                  <example.icon size={14} aria-hidden="true" />
                  {example.label}
                </SdkButton>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex flex-col items-end gap-1">
                {message.fileName ? (
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <FileText size={13} aria-hidden="true" />
                    {message.fileName}
                  </span>
                ) : null}
                {message.text ? (
                  <p className="assistant-user max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2 text-[14.5px]">
                    {message.text}
                  </p>
                ) : null}
              </div>
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                busy={busy}
                onProposalChange={(proposal) => update(message.id, { proposal })}
                onMakeDeck={(proposal) => void makeDeck(message.id, proposal)}
                onWriteDocument={(preview) => void writeFromDocument(message.id, preview)}
                onReadAs={(purpose) => {
                  const doc = message.document;
                  if (!doc) return;
                  update(message.id, { settled: true });
                  const stored = files.current.get(doc.fileKey);
                  const label = INTENTS.find((item) => item.value === purpose)?.label ?? purpose;
                  push({ id: newId(), role: "user", text: label });
                  void readDocument(
                    doc.fileKey,
                    stored ? { file: stored } : { text: "" },
                    "",
                    purpose,
                  );
                }}
                onOption={(option) => {
                  update(message.id, { settled: true });
                  void send(option.message, { force: option.force, shown: option.label });
                }}
              />
            ),
          )
        )}
      </div>

      <form
        className="border-border border-t-[0.5px] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        {file ? (
          <div className="bg-surface border-border mb-2 flex items-center gap-2.5 rounded-[14px] border py-1.5 pl-2 pr-1">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-lg"
              style={{ background: soft("blue"), color: strong("blue") }}
            >
              <FileText size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
            <SdkButton
              aria-label="Remove the file"
              onClick={() => setFile(null)}
              className="text-muted-foreground hover:bg-quiet grid size-7 place-items-center rounded-full"
            >
              <X size={14} aria-hidden="true" />
            </SdkButton>
          </div>
        ) : null}
        <div className="composer flex items-end gap-1 rounded-[20px] py-1 pl-1 pr-1">
          <SdkButton
            aria-label="Attach a file"
            title="Attach a PDF, Word or text file"
            onClick={() => fileInput.current?.click()}
            className="text-muted-foreground hover:bg-quiet hover:text-foreground mb-0.5 grid size-9 shrink-0 place-items-center rounded-full"
          >
            <Paperclip size={17} aria-hidden="true" />
          </SdkButton>
          <label htmlFor="assistant-box" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="assistant-box"
            ref={box}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              file ? "What do you want from it? (optional)" : "Paste a link, name a topic, or ask"
            }
            className="placeholder:text-subtle-foreground field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-[1.4] outline-none"
          />
          <SdkButton
            type="submit"
            aria-label="Send"
            disabled={busy || (draft.trim() === "" && !file)}
            className={cx(
              "mb-0.5 grid size-9 shrink-0 place-items-center rounded-full transition-colors",
              busy || (draft.trim() === "" && !file)
                ? "bg-border text-muted-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </SdkButton>
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
                push({
                  id: newId(),
                  role: "assistant",
                  error: true,
                  text: "That file is over 10 MB. Try a smaller part of it, or paste the text.",
                });
                return;
              }
              setFile(picked);
              box.current?.focus();
            }}
          />
        </div>
      </form>
    </section>
  );
}

/** **bold** and `code` inside a line. Everything else is text, never HTML. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={index} className="bg-quiet rounded px-1 py-0.5 font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string };

/** Splits a reply into paragraphs, lists and code blocks. */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (/^\s*```/.test(raw)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*\u2022]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1]!;
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      blocks.push({ kind: "p", text: line.replace(/^#+\s+/, "") });
    }
  }
  return blocks;
}

/**
 * A reply as written by the model or the rules: paragraphs, "- " and "1. " lists, code
 * fences, **bold** and `code`. Nothing is read as HTML.
 */
function ReplyText({ text, error }: { text: string; error?: boolean | undefined }) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-2 text-[14.5px] leading-[1.55]",
        error && "text-danger",
      )}
    >
      {blocksOf(text).map((block, index) =>
        block.kind === "p" ? (
          <p key={index}>
            <Inline text={block.text} />
          </p>
        ) : block.kind === "code" ? (
          <pre
            key={index}
            className="bg-canvas border-border overflow-x-auto rounded-xl border px-3 py-2.5 font-mono text-[13px] leading-[1.5]"
          >
            <code>{block.text}</code>
          </pre>
        ) : block.kind === "ul" ? (
          <ul
            key={index}
            className="marker:text-subtle-foreground flex list-disc flex-col gap-1 pl-5"
          >
            {block.items.map((entry, i) => (
              <li key={i}>
                <Inline text={entry} />
              </li>
            ))}
          </ul>
        ) : (
          <ol
            key={index}
            className="marker:text-subtle-foreground flex list-decimal flex-col gap-1 pl-5"
          >
            {block.items.map((entry, i) => (
              <li key={i}>
                <Inline text={entry} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  busy,
  onProposalChange,
  onMakeDeck,
  onWriteDocument,
  onReadAs,
  onOption,
}: {
  message: Extract<Message, { role: "assistant" }>;
  busy: boolean;
  onProposalChange: (proposal: Proposal) => void;
  onMakeDeck: (proposal: Proposal) => void;
  onWriteDocument: (preview: DocumentPreview) => void;
  onReadAs: (purpose: "study" | "topics" | "resume") => void;
  onOption: (option: Option) => void;
}) {
  const proposal = message.proposal;
  const doc = message.document;
  const open = !message.settled && !message.working;

  return (
    <div className="flex min-w-0 max-w-[94%] flex-col gap-2">
      {message.text ? <ReplyText text={message.text} error={message.error} /> : null}

      {proposal ? (
        <div className="assistant-card flex flex-col gap-2.5 rounded-2xl p-3">
          <p className="flex flex-wrap gap-1.5">
            {proposal.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{ background: soft("violet"), color: strong("violet") }}
              >
                {topic}
              </span>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {LEVELS.map((level) => (
              <SdkButton
                key={level}
                disabled={!open}
                aria-pressed={proposal.level === level}
                onClick={() => onProposalChange({ ...proposal, level })}
                className={cx("assistant-pill", proposal.level === level && "assistant-pill-on")}
              >
                {sentenceCase(level)}
              </SdkButton>
            ))}
            <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />
            {STYLES.map((style) => (
              <SdkButton
                key={style.value}
                disabled={!open}
                aria-pressed={proposal.style === style.value}
                onClick={() => onProposalChange({ ...proposal, style: style.value })}
                className={cx(
                  "assistant-pill",
                  proposal.style === style.value && "assistant-pill-on",
                )}
              >
                {style.label}
              </SdkButton>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Questions per topic</span>
            <SdkButton
              aria-label="Fewer questions per topic"
              disabled={!open || proposal.countPerTopic <= 1}
              onClick={() =>
                onProposalChange({ ...proposal, countPerTopic: proposal.countPerTopic - 1 })
              }
              className="assistant-pill w-7 px-0"
            >
              -
            </SdkButton>
            <span className="w-5 text-center font-semibold tabular-nums">
              {proposal.countPerTopic}
            </span>
            <SdkButton
              aria-label="More questions per topic"
              disabled={!open || proposal.countPerTopic >= 20}
              onClick={() =>
                onProposalChange({ ...proposal, countPerTopic: proposal.countPerTopic + 1 })
              }
              className="assistant-pill w-7 px-0"
            >
              +
            </SdkButton>
          </div>
          {open ? (
            <SdkButton
              disabled={busy}
              onClick={() => onMakeDeck(proposal)}
              className="session-primary min-h-10! px-5! text-sm! self-start"
            >
              Make it: {proposal.topics.length * proposal.countPerTopic} questions
            </SdkButton>
          ) : null}
        </div>
      ) : null}

      {doc && open ? (
        doc.intent === "unclear" || !doc.sourceId ? (
          <div className="flex flex-col gap-1.5">
            {INTENTS.map((intent) => (
              <SdkButton
                key={intent.value}
                disabled={busy}
                onClick={() => onReadAs(intent.value)}
                className="assistant-card flex items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-sm font-medium"
              >
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: soft(intent.hue), color: strong(intent.hue) }}
                >
                  <intent.icon size={15} aria-hidden="true" />
                </span>
                {intent.label}
              </SdkButton>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {doc.intent === "topics" && doc.topics?.length ? (
              <p className="flex w-full flex-wrap gap-1.5">
                {doc.topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ background: soft("violet"), color: strong("violet") }}
                  >
                    {topic}
                  </span>
                ))}
              </p>
            ) : null}
            <SdkButton
              disabled={busy}
              onClick={() => onWriteDocument(doc)}
              className="session-primary min-h-10! px-5! text-sm!"
            >
              Looks right, write questions
            </SdkButton>
            <SdkButton
              disabled={busy}
              onClick={() => onReadAs(doc.intent === "study" ? "topics" : "study")}
              className="quiet-chip h-10!"
            >
              Not what I meant
            </SdkButton>
          </div>
        )
      ) : null}

      {message.options && open ? (
        <div className="flex flex-wrap gap-2">
          {message.options.map((option) => (
            <SdkButton
              key={option.label}
              disabled={busy}
              onClick={() => onOption(option)}
              className="quiet-chip"
            >
              {option.label}
            </SdkButton>
          ))}
        </div>
      ) : null}

      {message.sources?.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-subtle-foreground text-xs font-semibold">From your library</p>
          <ul className="flex flex-col gap-1">
            {message.sources.slice(0, 3).map((source) => (
              <li key={source.id}>
                <a
                  href={source.href}
                  className="assistant-card hover:border-primary flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm transition-colors"
                >
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-md"
                    style={{
                      background: soft(source.kind === "link" ? "blue" : "violet"),
                      color: strong(source.kind === "link" ? "blue" : "violet"),
                    }}
                  >
                    {source.kind === "link" ? (
                      <Link2 size={13} aria-hidden="true" />
                    ) : (
                      <Brain size={13} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{source.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.working ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="border-primary size-3.5 animate-spin rounded-full border-2 border-t-transparent" />
          {message.working}
        </p>
      ) : null}

      {message.links?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.links.map((link) => (
            <a key={link.href} href={link.href} className="session-primary min-h-9! px-4! text-sm!">
              {link.label}
            </a>
          ))}
        </div>
      ) : null}

      {message.settled && (proposal || doc) && !message.working && !message.links ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Check size={13} aria-hidden="true" />
          Done
        </p>
      ) : null}
    </div>
  );
}
