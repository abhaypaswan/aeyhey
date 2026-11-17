"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// New deck, from topics or from a resume (PRD 8.2 FR-Q-1, FR-Q-2, 12.2).
//
// The resume flow shows the extracted text back before generating anything, because a PDF
// that parsed badly produces questions about nothing and the user is the only one who can
// tell. It also says what was stripped, so the privacy promise is visible rather than
// just documented.

import { useState } from "react";
import { apiClient, ApiRequestError, waitForJob } from "../lib/client";
import {
  Button,
  Card,
  CardTitle,
  Columns,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  Spinner,
} from "./ui";
import { NumberBox, SelectField } from "./form";

type Stage = "form" | "confirm_text" | "generating" | "failed";

const LEVELS = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff" },
];

const STYLES = [
  { value: "interview", label: "Interview questions" },
  { value: "study", label: "Study checks" },
  { value: "mixed", label: "A mix" },
];

export function NewDeckForm({ mode }: { mode: "topics" | "resume" }) {
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("Getting started");

  // Topics.
  const [topicsText, setTopicsText] = useState("");
  const [level, setLevel] = useState("mid");
  const [style, setStyle] = useState("interview");
  const [countPerTopic, setCountPerTopic] = useState(5);
  const [extraContext, setExtraContext] = useState("");

  // Resume.
  const [resumeText, setResumeText] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [parsed, setParsed] = useState<{
    sourceId: string;
    extractedText: string;
    redactions: { emails: number; phones: number };
    suspicious: boolean;
    note: string | null;
  } | null>(null);

  const topics = topicsText
    .split(/[,\n]/)
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0)
    .slice(0, 10);

  async function runJob(jobId: string, sourceId: string): Promise<void> {
    setStage("generating");

    const status = await waitForJob(jobId, {
      onProgress: (job) => {
        if (job.type === "build_profile") setProgress("Reading your resume");
        else if (job.progress.total) {
          setProgress(`Writing questions (${job.progress.done} of ${job.progress.total})`);
        } else setProgress("Writing questions");
      },
    });

    if (status.status === "blocked") {
      setError(status.blocked ?? "That needs credits to carry on.");
      setStage("failed");
      return;
    }
    if (status.status === "failed") {
      setError(status.error ?? "Generation did not finish.");
      setStage("failed");
      return;
    }

    window.location.href = `/decks/new/review?source=${sourceId}`;
  }

  async function submitTopics(): Promise<void> {
    if (topics.length === 0) return;
    setError(null);

    try {
      const result = await apiClient.post<{ sourceId: string; jobId: string }>(
        "/api/question-sources/topics",
        {
          topics,
          level,
          style,
          countPerTopic,
          ...(extraContext.trim() ? { extraContext: extraContext.trim() } : {}),
        },
      );
      await runJob(result.jobId, result.sourceId);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      setStage("failed");
    }
  }

  async function submitResumeText(): Promise<void> {
    if (resumeText.trim().length < 50) return;
    setError(null);

    try {
      const result = await apiClient.post<NonNullable<typeof parsed>>(
        "/api/question-sources/resume",
        {
          text: resumeText,
          ...(targetRole.trim() ? { targetRole: targetRole.trim() } : {}),
          ...(jobDescription.trim() ? { jobDescription: jobDescription.trim() } : {}),
        },
      );
      setParsed(result);
      // Confirm what we read before spending anything on generating from it.
      setStage("confirm_text");
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    }
  }

  async function generateFromResume(): Promise<void> {
    if (!parsed) return;
    setError(null);

    try {
      const result = await apiClient.post<{ jobId: string }>(
        `/api/question-sources/${parsed.sourceId}/generate`,
      );
      await runJob(result.jobId, parsed.sourceId);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      setStage("failed");
    }
  }

  if (stage === "generating") {
    return (
      <Shell title="Writing your questions">
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner label={progress} />
          <p className="text-muted-foreground text-sm">
            This takes a minute or two. You can leave this page and come back to your decks.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={mode === "resume" ? "New deck from your resume" : "New deck from topics"}>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === "topics" ? (
        <Card className="flex flex-col gap-4">
          <Field label="Topics" hint="One per line, or separated by commas. Up to 10.">
            <textarea
              autoFocus
              value={topicsText}
              onChange={(event) => setTopicsText(event.target.value)}
              rows={4}
              placeholder={"Postgres indexing\nsystem design\nTypeScript generics"}
              className="border-border bg-background focus-visible:border-primary w-full resize-y rounded-lg border p-3 text-sm outline-none"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Level" value={level} onValueChange={setLevel} options={LEVELS} />

            <SelectField label="Style" value={style} onValueChange={setStyle} options={STYLES} />
          </div>

          <Field label="Questions per topic" hint="Up to 20.">
            <NumberBox min={1} max={20} value={countPerTopic} onValueChange={setCountPerTopic} />
          </Field>

          <Field label="Anything else worth knowing?" hint="Optional.">
            <Input
              value={extraContext}
              onChange={(event) => setExtraContext(event.target.value)}
              placeholder="Interviewing at a fintech, Python backend"
            />
          </Field>

          <p className="text-muted-foreground text-sm">
            {topics.length === 0
              ? "Add at least one topic."
              : `${topics.length * countPerTopic} questions from ${topics.length} ${topics.length === 1 ? "topic" : "topics"}.`}
          </p>

          <Button tone="primary" disabled={topics.length === 0} onClick={submitTopics} fullWidth>
            Write the questions
          </Button>
        </Card>
      ) : null}

      {mode === "resume" && stage !== "confirm_text" ? (
        <Card className="flex flex-col gap-4">
          <Notice tone="info">
            Your resume stays on this machine. Emails and phone numbers are removed before anything
            goes to an AI provider, and the text is only kept so questions can be generated from it.
          </Notice>

          <Field
            label="Paste your resume"
            hint="Plain text works best. If you have a PDF, open it and copy the text."
          >
            <textarea
              autoFocus
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              rows={14}
              className="border-border bg-background focus-visible:border-primary w-full resize-y rounded-lg border p-3 font-mono text-xs outline-none"
            />
          </Field>

          <Field label="Target role" hint="Optional, and it makes the questions much sharper.">
            <Input
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="Senior Backend Engineer"
            />
          </Field>

          <Field label="Job description" hint="Optional. Paste the one you are applying to.">
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              rows={5}
              className="border-border bg-background focus-visible:border-primary w-full resize-y rounded-lg border p-3 text-sm outline-none"
            />
          </Field>

          <Button
            tone="primary"
            disabled={resumeText.trim().length < 50}
            onClick={submitResumeText}
            fullWidth
          >
            Check what Aeyhey read
          </Button>
        </Card>
      ) : null}

      {mode === "resume" && stage === "confirm_text" && parsed ? (
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Does this look right?</h2>
          <p className="text-muted-foreground text-sm">
            This is what Aeyhey will write questions from. If it looks wrong, go back and paste it
            again.
          </p>

          {parsed.suspicious && parsed.note ? <Notice tone="warning">{parsed.note}</Notice> : null}

          {parsed.redactions.emails + parsed.redactions.phones > 0 ? (
            <Notice tone="success">
              Removed {parsed.redactions.emails} email
              {parsed.redactions.emails === 1 ? "" : "s"} and {parsed.redactions.phones} phone
              number{parsed.redactions.phones === 1 ? "" : "s"} before storing it.
            </Notice>
          ) : null}

          <pre className="border-border bg-muted max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border p-3 font-mono text-xs">
            {parsed.extractedText}
          </pre>

          <div className="flex gap-2">
            <Button tone="primary" onClick={generateFromResume} fullWidth>
              Looks right, write the questions
            </Button>
            <Button onClick={() => setStage("form")}>Back</Button>
          </div>
        </Card>
      ) : null}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Page>
      <PageHeader
        back={{ href: "/decks", label: "Decks" }}
        title={title}
        subtitle="Aeyhey writes the questions and a worked answer for each, and they go straight into your sessions."
      />
      <Columns
        aside={
          <Card className="flex flex-col gap-3">
            <CardTitle>What happens next</CardTitle>
            <ol className="text-muted-foreground flex list-decimal flex-col gap-2 pl-4 text-sm">
              <li>Aeyhey writes the questions. This takes up to a minute.</li>
              <li>They start coming up in your sessions right away.</li>
              <li>Before each reminder, Aeyhey writes a few more. Remove any that miss.</li>
            </ol>
          </Card>
        }
      >
        {children}
      </Columns>
    </Page>
  );
}
