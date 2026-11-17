"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// AI provider setup (PRD 8.4 FR-SET-2, 12.1 screen 1).
//
// Test before save, so a wrong key is never stored. The error messages come from the
// server's provider layer, which turns a 401 or a missing Ollama model into a sentence
// that says what to do about it.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, Field, Input, Notice, Page, PageHeader } from "./ui";
import { PasswordBox } from "./form";
import { SelectField } from "./form";

type Kind = "openai" | "anthropic" | "ollama";

const MODEL_SUGGESTIONS: Record<Kind, { summary: string; generate: string; grade: string }> = {
  openai: { summary: "gpt-4o-mini", generate: "gpt-4o", grade: "gpt-4o-mini" },
  anthropic: {
    summary: "claude-haiku-5-5",
    generate: "claude-sonnet-5-5",
    grade: "claude-haiku-5-5",
  },
  ollama: { summary: "llama3.1:8b", generate: "llama3.1:8b", grade: "llama3.1:8b" },
};

export function AiSettings({
  locked,
  flags,
  firstRun,
  defaults,
  current,
}: {
  locked: string[];
  flags: { byoKeys: boolean; ollama: boolean };
  firstRun: boolean;
  defaults: { ollamaUrl: string; openaiUrl: string };
  /** The provider the environment already set, so the form opens on it rather than on a
   *  guess that contradicts the notice above it. */
  current?: Kind;
}) {
  const initialKind: Kind = current ?? (flags.ollama ? "ollama" : "openai");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    initialKind === "ollama" ? defaults.ollamaUrl : defaults.openaiUrl,
  );
  const [models, setModels] = useState(MODEL_SUGGESTIONS[initialKind]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isLocked = locked.includes("ai.provider");
  const needsKey = kind !== "ollama";

  function changeKind(next: Kind): void {
    setKind(next);
    setModels(MODEL_SUGGESTIONS[next]);
    setBaseUrl(next === "ollama" ? defaults.ollamaUrl : defaults.openaiUrl);
    setResult(null);
  }

  function payload(): unknown {
    return {
      kind,
      ...(needsKey && apiKey ? { apiKey } : {}),
      ...(kind !== "anthropic" ? { baseUrl } : {}),
      models,
      isDefault: true,
    };
  }

  async function test(): Promise<void> {
    setTesting(true);
    setResult(null);
    try {
      const response = await apiClient.post<{ ok: boolean; message: string }>(
        "/api/ai/providers/test",
        payload(),
      );
      setResult(response);
    } catch (thrown) {
      setResult({
        ok: false,
        message: thrown instanceof ApiRequestError ? thrown.message : "That test did not run.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await apiClient.post("/api/ai/providers", payload());
      window.location.href = firstRun ? "/" : "/settings";
    } catch (thrown) {
      setResult({
        ok: false,
        message: thrown instanceof ApiRequestError ? thrown.message : "That did not save.",
      });
      setSaving(false);
    }
  }

  return (
    <Page width="narrow">
      <PageHeader
        back={
          firstRun ? { href: "/", label: "Skip for now" } : { href: "/settings", label: "Settings" }
        }
        title="AI provider"
        subtitle="The model that summarises your links, writes questions and grades your answers."
      />

      {firstRun ? (
        <Notice tone="info">
          You can skip this. Links still save and you can write questions yourself. Add a provider
          whenever you want summaries and grading.
        </Notice>
      ) : null}

      {isLocked ? (
        <Notice tone="warning">
          The provider is set in your environment, so saving here will not change it.
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-4">
        <SelectField
          label="Provider"
          value={kind}
          onValueChange={changeKind}
          options={[
            ...(flags.ollama
              ? ([{ value: "ollama", label: "Ollama, on this machine" }] as const)
              : []),
            { value: "openai", label: "OpenAI, or anything OpenAI-compatible" },
            { value: "anthropic", label: "Anthropic" },
          ]}
        />

        {kind === "ollama" ? (
          <Notice tone="success">
            With Ollama, your links and your resume never leave this machine. Pull a model first
            with <code className="font-mono text-xs">ollama pull llama3.1:8b</code>.
          </Notice>
        ) : null}

        {kind !== "anthropic" ? (
          <Field
            label={kind === "ollama" ? "Ollama URL" : "Base URL"}
            hint={
              kind === "ollama"
                ? "From inside Docker this is usually http://ollama:11434"
                : "Change this for OpenRouter, Groq, LM Studio or vLLM."
            }
          >
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
        ) : null}

        {needsKey ? (
          <Field
            label="API key"
            hint="Encrypted before it is stored, and never shown again after you save."
          >
            <PasswordBox
              autoComplete="off"
              value={apiKey}
              onValueChange={setApiKey}
              placeholder={kind === "anthropic" ? "sk-ant-..." : "sk-..."}
            />
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Summaries">
            <Input
              value={models.summary}
              onChange={(event) => setModels({ ...models, summary: event.target.value })}
            />
          </Field>
          <Field label="Questions">
            <Input
              value={models.generate}
              onChange={(event) => setModels({ ...models, generate: event.target.value })}
            />
          </Field>
          <Field label="Grading">
            <Input
              value={models.grade}
              onChange={(event) => setModels({ ...models, grade: event.target.value })}
            />
          </Field>
        </div>

        {result ? <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice> : null}

        <div className="flex gap-2">
          <Button disabled={testing || (needsKey && !apiKey)} onClick={test}>
            {testing ? "Testing" : "Test connection"}
          </Button>
          <Button
            tone="primary"
            disabled={saving || (needsKey && !apiKey)}
            onClick={save}
            className="flex-1"
          >
            {saving ? "Saving" : "Save"}
          </Button>
        </div>
      </Card>
    </Page>
  );
}
