"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The "Your page" screen (PRD 28). Before the page exists it asks for a name; after, it
// shows the address, the public switch, the page's words and what is on it.

import { useEffect, useRef, useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { hostOf } from "../lib/format";
import { SelectField, SwitchField } from "./form";
import { BookOpen, Copy, ExternalLink, Globe } from "./icons";
import { PublicPageWork, type WorkSide } from "./public-page-work";
import {
  Button,
  Card,
  CardTitle,
  Columns,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Notice,
  Page,
  PageHeader,
  Textarea,
  cx,
} from "./ui";

export interface PageProfile {
  handle: string;
  title: string | null;
  bio: string | null;
  enabled: boolean;
  indexable: boolean;
  showFooter: boolean;
  showStats: boolean;
  /** What visitors see of work with coding agents. */
  buildingVisibility: "off" | "numbers" | "highlights";
  showAgentModels: boolean;
}

const BUILDING_OPTIONS = [
  { value: "off", label: "Keep it private" },
  { value: "numbers", label: "Numbers only" },
  { value: "highlights", label: "Numbers and kept highlights" },
] as const;

export interface PageLink {
  id: string;
  url: string;
  title: string | null;
  site: string | null;
  takeaway: string;
  sharedAt: string;
}

interface HandleCheck {
  handle: string;
  available: boolean;
  problem: string | null;
}

interface SettingsResponse {
  profile: PageProfile | null;
}

/** Checks a handle as it is typed, a moment after the typing stops. */
function useHandleCheck(value: string, current: string | null) {
  const [check, setCheck] = useState<HandleCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const wanted = value.trim().toLowerCase();
    setCheck(null);
    if (!wanted || wanted === current) {
      setChecking(false);
      return;
    }
    setChecking(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await apiClient.get<HandleCheck>(
          `/api/public-page/handle-check?handle=${encodeURIComponent(wanted)}`,
        );
        if (mine === seq.current) setCheck(result);
      } catch {
        // The save will say what is wrong if it still is.
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [value, current]);

  const unchanged = value.trim().toLowerCase() === current;
  return {
    ok: unchanged || check?.available === true,
    hint: unchanged
      ? undefined
      : checking
        ? "Checking..."
        : check?.available
          ? "That name is free."
          : undefined,
    error: !unchanged && check && !check.available ? (check.problem ?? undefined) : undefined,
  };
}

function cleanHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export function PublicPageSettings({
  prefix,
  displayName,
  suggested,
  initial,
  work,
  links,
}: {
  prefix: string;
  displayName: string | null;
  suggested: string;
  initial: PageProfile | null;
  work: WorkSide | null;
  links: PageLink[];
}) {
  if (!initial || !work) return <SetUp prefix={prefix} suggested={suggested} />;
  return (
    <YourPage
      prefix={prefix}
      displayName={displayName}
      initial={initial}
      work={work}
      links={links}
    />
  );
}

// ---------------------------------------------------------------- set up

function SetUp({ prefix, suggested }: { prefix: string; suggested: string }) {
  const [handle, setHandle] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useHandleCheck(handle, null);
  const shortPrefix = prefix.replace(/^https?:\/\//, "");

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Turned on at once: nothing is on it yet, and every link still needs its own
      // takeaway before it shows.
      await apiClient.patch("/api/public-page", { handle, enabled: true });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <Page width="narrow">
      <PageHeader
        title="What I learned"
        subtitle="A public page of things you read, each with what you took from it. Put the link in your bio and people can follow along."
      />
      <Card padding="lg" className="flex flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          Nothing goes on it by itself. You choose each link and write the takeaway.
        </p>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (check.ok && handle) void create();
          }}
        >
          <Field
            label="Pick a name for your page"
            hint={check.hint ?? `Your page will be at ${shortPrefix}${handle || "yourname"}`}
            {...(check.error ? { error: check.error } : {})}
          >
            <Input
              value={handle}
              onChange={(event) => setHandle(cleanHandle(event.target.value))}
              maxLength={30}
              autoComplete="off"
              spellCheck={false}
              placeholder="yourname"
            />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            type="submit"
            tone="primary"
            disabled={busy || !handle || !check.ok}
            className="self-start"
          >
            Create my page
          </Button>
        </form>
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- the page

function YourPage({
  prefix,
  displayName,
  initial,
  work,
  links,
}: {
  prefix: string;
  displayName: string | null;
  initial: PageProfile;
  work: WorkSide;
  links: PageLink[];
}) {
  const [saved, setSaved] = useState(initial);
  const [handle, setHandle] = useState(initial.handle);
  const [title, setTitle] = useState(initial.title ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [indexable, setIndexable] = useState(initial.indexable);
  const [showFooter, setShowFooter] = useState(initial.showFooter);
  const [showStats, setShowStats] = useState(initial.showStats);
  const [building, setBuilding] = useState(initial.buildingVisibility ?? "off");
  const [showModels, setShowModels] = useState(initial.showAgentModels ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const check = useHandleCheck(handle, saved.handle);

  const url = `${prefix}${saved.handle}`;
  const shortUrl = url.replace(/^https?:\/\//, "");
  const defaultTitle = `What ${displayName ?? saved.handle} learned`;
  const dirty =
    handle !== saved.handle ||
    title.trim() !== (saved.title ?? "") ||
    bio.trim() !== (saved.bio ?? "") ||
    indexable !== saved.indexable ||
    showFooter !== saved.showFooter ||
    showStats !== saved.showStats ||
    building !== saved.buildingVisibility ||
    showModels !== saved.showAgentModels;

  async function patch(body: Record<string, unknown>, done: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.patch<SettingsResponse>("/api/public-page", body);
      if (result.profile) setSaved(result.profile);
      setMessage({ ok: true, text: done });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ ok: false, text: "Could not copy. Select the address and copy it instead." });
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Your page"
        subtitle="What you learned from what you read, at an address you can share."
        action={
          <LinkButton href={`/u/${saved.handle}`} icon={ExternalLink} external>
            View your page
          </LinkButton>
        }
      />

      <Columns
        asideWidth="lg"
        aside={
          <>
            <Card
              className={cx(
                "flex flex-col gap-4",
                saved.enabled && "border-primary/30 bg-primary-soft/40",
              )}
            >
              <div className="flex items-center gap-3">
                <Globe
                  size={18}
                  aria-hidden="true"
                  className={saved.enabled ? "text-primary" : "text-subtle-foreground"}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{shortUrl}</span>
                <Button size="sm" tone="ghost" icon={Copy} onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <SwitchField
                label="Public"
                description={
                  saved.enabled
                    ? "Anyone with the link can see it."
                    : "Hidden. Only you can see what is on it."
                }
                checked={saved.enabled}
                disabled={busy}
                onCheckedChange={(on) =>
                  void patch({ enabled: on }, on ? "Your page is public." : "Your page is hidden.")
                }
              />
            </Card>

            <Card className="flex flex-col gap-4">
              <CardTitle>About the page</CardTitle>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void patch(
                    {
                      ...(handle !== saved.handle ? { handle } : {}),
                      title: title.trim(),
                      bio: bio.trim(),
                      indexable,
                      showFooter,
                      showStats,
                      buildingVisibility: building,
                      showAgentModels: showModels,
                    },
                    handle !== saved.handle
                      ? "Saved. The old address sends people here for 30 days."
                      : "Saved.",
                  );
                }}
              >
                <Field
                  label="Name and address"
                  hint={check.hint ?? `${prefix.replace(/^https?:\/\//, "")}${handle}`}
                  {...(check.error ? { error: check.error } : {})}
                >
                  <Input
                    value={handle}
                    onChange={(event) => setHandle(cleanHandle(event.target.value))}
                    maxLength={30}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Title" hint={`Left empty, it reads "${defaultTitle}".`}>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={80}
                    placeholder={defaultTitle}
                  />
                </Field>
                <Field label="About you" hint={`${bio.length} of 160`}>
                  <Textarea
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    maxLength={160}
                    rows={3}
                    placeholder="One line about what you read and why"
                  />
                </Field>
                <SwitchField
                  label="Show my stats"
                  description="Streaks, days read, totals and topics. Question decks always stay private."
                  checked={showStats}
                  onCheckedChange={setShowStats}
                />
                <SelectField
                  label="Work with coding agents"
                  description="Private shows nothing at all, not even in your streak. Highlights you hide in Journal never show."
                  value={building}
                  onValueChange={setBuilding}
                  options={BUILDING_OPTIONS}
                />
                {building !== "off" ? (
                  <SwitchField
                    label="Show models and tokens"
                    description="Which models you used and how many tokens. Off by default."
                    checked={showModels}
                    onCheckedChange={setShowModels}
                  />
                ) : null}
                <SwitchField
                  label="Let search engines find it"
                  description="Off means only people with the link find it."
                  checked={indexable}
                  onCheckedChange={setIndexable}
                />
                <SwitchField
                  label='Show "Made with Aeyhey"'
                  description="A small line at the bottom of the page."
                  checked={showFooter}
                  onCheckedChange={setShowFooter}
                />
                <Button
                  type="submit"
                  tone="primary"
                  disabled={busy || !dirty || !handle || !check.ok}
                  className="self-start"
                >
                  Save
                </Button>
              </form>
            </Card>
            {message ? (
              <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice>
            ) : null}
          </>
        }
      >
        <PublicPageWork initial={work} />

        <section className="flex flex-col gap-4" aria-labelledby="on-your-page">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="on-your-page" className="text-lg font-bold">
              On your page
            </h2>
            {links.length > 0 ? (
              <span className="text-muted-foreground text-sm">
                {links.length === 1 ? "1 link" : `${links.length} links`}
              </span>
            ) : null}
          </div>
          {links.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Nothing here yet"
              body='Open a link you have read and use "Add to my page" to write what you learned from it.'
              action={
                <LinkButton href="/inbox?status=read" tone="secondary">
                  See what you have read
                </LinkButton>
              }
            />
          ) : (
            <Card padding="none">
              <ul className="divide-border divide-y">
                {links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={`/links/${link.id}#takeaway`}
                      className="hover:bg-sunken/60 block px-5 py-4 transition-colors"
                    >
                      <p className="text-subtle-foreground text-xs">
                        {link.site ?? hostOf(link.url)}
                      </p>
                      <p className="mt-0.5 font-semibold">{link.title ?? link.url}</p>
                      <p className="border-primary text-muted-foreground mt-2 border-l-2 pl-3 text-sm leading-relaxed">
                        {link.takeaway}
                      </p>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </Columns>
    </Page>
  );
}
