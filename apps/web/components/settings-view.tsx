"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Settings (PRD 8.4, 12.1 screen 11).
//
// A handful of tabs, each saving on its own, apart from Appearance, which applies as you
// pick. A field the environment has taken over is shown
// greyed out and labelled, so a change that would do nothing is visible rather than
// mysterious (PRD 16.2).

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Tabs, TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { Button, Card, CardTitle, Columns, Field, Notice, Page, cx } from "./ui";
import { AppearanceSettings } from "./appearance-settings";
import { SignedInApps } from "./signed-in-apps";
import { NumberBox, SearchSelectField, SelectField, SliderBox, SwitchField, TimeBox } from "./form";
import type { TimezoneOption } from "../lib/timezones";
import { Toggle } from "@ui-sdk/react/toggle";
import { ProfileSettings } from "./profile-settings";
import { AgentSettings } from "./agent-settings";

interface Settings {
  cadence: "daily" | "weekly" | "monthly";
  cadenceWeekdays: number[];
  cadenceDayOfMonth: number;
  sendTime: string;
  quietHours: { start: string; end: string } | null;
  cardsPerSession: number;
  mixMode: "auto" | "explicit";
  mixLinks: number;
  mixQuestions: number;
  maxNewQuestions: number;
  maxNewLinks: number;
  requestRetention: number;
  expiryEnabled: boolean;
  expiryMaxSnoozes: number;
  expiryMaxIgnored: number;
  expiryUnreadDays: number;
  stripPii: boolean;
  pausedUntil: string | null;
  timezone: string;
}

interface Flags {
  byoKeys: boolean;
  ollama: boolean;
  customSmtp: boolean;
  customTelegramBot: boolean;
  credits: boolean;
}

const TABS = [
  { id: "schedule", label: "Schedule" },
  { id: "notifications", label: "Notifications" },
  { id: "ai", label: "AI" },
  { id: "links", label: "Link rules" },
  { id: "agents", label: "Agents" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Data" },
  { id: "profile", label: "Account" },
] as const;

/** One paragraph beside each tab, saying what the settings in it are for. */
const HELP: Record<(typeof TABS)[number]["id"], { title: string; body: string }> = {
  profile: {
    title: "About your account",
    body: "Your name and picture show in Aeyhey and on your profile, if you have one. The picture is cropped to a square before it is sent.",
  },
  schedule: {
    title: "About the schedule",
    body: "This sets how often a session is offered and how many cards are in it. Smaller and more often usually works better than large and rare. You can always start an extra session yourself.",
  },
  notifications: {
    title: "About notifications",
    body: "A reminder is a nudge that a session is ready. Pick the channels you actually look at. Nothing is sent during quiet hours.",
  },
  ai: {
    title: "About AI",
    body: "Aeyhey uses a model to summarise links, write questions and grade answers. Use your own key, or a local model so nothing leaves this machine.",
  },
  links: {
    title: "About link rules",
    body: "A link you keep putting off comes back less often. With expiry on, one you never act on is eventually retired, so the pile does not grow without end. Nothing is deleted.",
  },
  agents: {
    title: "About agents",
    body: "Coding agents such as Claude Code report each finished session to Aeyhey. Once a day is over, Aeyhey writes a short summary of what you built. It shows on your profile only if you turn that on; the session logs themselves never show.",
  },
  appearance: {
    title: "About appearance",
    body: "Seven colour themes, each with a light and a dark version. Status colours such as Unread and Last chance stay the same in all of them.",
  },
  data: {
    title: "About your data",
    body: "Everything you save lives in this instance's own database. The export is plain JSON that you can keep as a backup or take elsewhere.",
  },
};

const CADENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const satisfies readonly { value: Settings["cadence"]; label: string }[];

const MIX_MODES = [
  { value: "auto", label: "Let Aeyhey decide" },
  { value: "explicit", label: "I will choose" },
] as const satisfies readonly { value: Settings["mixMode"]; label: string }[];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(day: number): string {
  const tail =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th");
  return `${day}${tail}`;
}

/** "Every Mon, Wed and Fri at 09:00", as the phone's Settings says it. */
function scheduleSentence(settings: Settings): string {
  const at = `at ${settings.sendTime}`;
  if (settings.cadence === "daily") return `Every day ${at}`;
  if (settings.cadence === "monthly") {
    return settings.cadenceDayOfMonth === -1
      ? `On the last day of each month ${at}`
      : `On the ${ordinal(settings.cadenceDayOfMonth)} of each month ${at}`;
  }
  const days = [...settings.cadenceWeekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 1) return `Every ${DAY_NAMES[days[0] ?? 1]} ${at}`;
  const short = days.map((day) => WEEKDAYS[day] ?? "");
  const list = `${short.slice(0, -1).join(", ")} and ${short[short.length - 1]}`;
  return `Every ${list} ${at}`;
}

function sessionSentence(settings: Settings): string {
  const cards = `${settings.cardsPerSession} card${settings.cardsPerSession === 1 ? "" : "s"} a session`;
  const fresh =
    settings.maxNewQuestions > 0
      ? `, with up to ${settings.maxNewQuestions} new question${settings.maxNewQuestions === 1 ? "" : "s"} kept ready.`
      : ", no new questions.";
  const quiet = settings.quietHours
    ? ` Quiet from ${settings.quietHours.start} to ${settings.quietHours.end}.`
    : "";
  const paused = settings.pausedUntil ? " Reminders are paused." : "";
  return `${cards}${fresh}${quiet}${paused}`;
}

export function SettingsView({
  initial,
  locked,
  flags,
  channels,
  timezones,
  profile,
  initialTab,
  publicUrl,
  accountHref = null,
}: {
  initial: Settings;
  /** From ?tab= in the address, so a link can open a tab such as profile. */
  initialTab?: string;
  /** Where this instance is reached, for the agent setup snippets. */
  publicUrl: string;
  /** Where the account is deleted, when the sign-in provider has accounts (hosted). */
  accountHref?: string | null;
  profile: { displayName: string; avatarUrl: string | null };
  timezones: TimezoneOption[];
  locked: string[];
  flags: Flags;
  channels: { telegramConfigured: boolean; telegramConnected: boolean; emailConfigured: boolean };
}) {
  // The AI tab is only for choosing a model: your own key, or a local Ollama. Where the
  // server runs the AI for everyone (the hosted edition) there is nothing to choose.
  const tabs = TABS.filter((option) => option.id !== "ai" || flags.byoKeys || flags.ollama);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(
    tabs.find((option) => option.id === initialTab)?.id ?? "schedule",
  );
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLocked = (key: string): boolean => locked.includes(key);

  function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const { pausedUntil: _pausedUntil, ...patch } = settings;
      await apiClient.patch("/api/settings", patch);
      setSaved(true);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "Those did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="wide">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[30px] font-[640] leading-[1.1] lg:text-4xl">Settings</h1>
        {/* The schedule said back in one sentence, which changes as the controls do. */}
        <p
          className={cx(
            "font-display mt-1.5 text-[19px] font-[560] leading-[1.3] lg:text-[22px]",
            settings.pausedUntil ? "text-muted-foreground" : "text-primary",
          )}
        >
          {scheduleSentence(settings)}
        </p>
        <p className="text-muted-foreground text-[15px] leading-[1.45]">
          {sessionSentence(settings)}
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => next && setTab(next as (typeof TABS)[number]["id"])}
      >
        <TabsList aria-label="Settings sections">
          {tabs.map((option) => (
            <TabsTab key={option.id} value={option.id}>
              {option.label}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      <Columns
        aside={
          <>
            <Card className="flex flex-col gap-2">
              <CardTitle>{HELP[tab].title}</CardTitle>
              <p className="text-muted-foreground text-sm leading-relaxed">{HELP[tab].body}</p>
            </Card>
            {/* The phone's bottom bar has no room for it, so it is reachable from here. */}
            <Card className="flex flex-col gap-2">
              <CardTitle>Profile</CardTitle>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your public page: what you learned from what you read, and what you built.
              </p>
              <a href="/profile" className="text-primary text-sm font-semibold underline">
                Open your profile
              </a>
            </Card>
          </>
        }
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="success">Saved.</Notice> : null}

        {tab === "appearance" ? <AppearanceSettings /> : null}
        {tab === "profile" ? <ProfileSettings initial={profile} /> : null}
        {tab === "agents" ? <AgentSettings publicUrl={publicUrl} /> : null}

        {tab === "schedule" ? (
          <Card className="flex flex-col gap-4">
            <SelectField
              label="How often"
              value={settings.cadence}
              onValueChange={(next) => set("cadence", next)}
              options={CADENCES}
            />

            {settings.cadence === "weekly" ? (
              <Field label="Which days">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((label, day) => {
                    const on = settings.cadenceWeekdays.includes(day);
                    return (
                      <Toggle
                        key={day}
                        pressed={on}
                        onPressedChange={(next) =>
                          set(
                            "cadenceWeekdays",
                            next
                              ? [...settings.cadenceWeekdays, day].sort()
                              : settings.cadenceWeekdays.filter((value) => value !== day),
                          )
                        }
                        className="bg-sunken text-muted-foreground data-pressed:bg-primary data-pressed:text-primary-foreground min-h-10 cursor-pointer rounded-lg px-3 text-xs font-semibold"
                      >
                        {label}
                      </Toggle>
                    );
                  })}
                </div>
              </Field>
            ) : null}

            {settings.cadence === "monthly" ? (
              <>
                {/* -1 is the last day of each month, so a 31st never skips a short month. */}
                <SwitchField
                  label="On the last day of each month"
                  description="The 28th, 29th, 30th or 31st, whichever ends the month."
                  checked={settings.cadenceDayOfMonth === -1}
                  onCheckedChange={(last) => set("cadenceDayOfMonth", last ? -1 : 28)}
                />
                {settings.cadenceDayOfMonth !== -1 ? (
                  <Field label="Day of the month" hint="1 to 28, so every month has it.">
                    <NumberBox
                      min={1}
                      max={28}
                      value={settings.cadenceDayOfMonth}
                      onValueChange={(next) => set("cadenceDayOfMonth", next)}
                    />
                  </Field>
                ) : null}
              </>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time of day" hint="In your own timezone.">
                <TimeBox
                  value={settings.sendTime}
                  onValueChange={(next) => set("sendTime", next)}
                />
              </Field>

              <SearchSelectField
                label="Timezone"
                description="Type a city or region to search."
                value={settings.timezone}
                onValueChange={(next) => set("timezone", next)}
                options={timezones}
                placeholder="Search timezones"
                emptyText="No timezone matches that."
                showAllLabel="Show all timezones"
              />
            </div>

            <Field label="Cards per session" hint="1 to 30. Five is a good default.">
              <NumberBox
                min={1}
                max={30}
                value={settings.cardsPerSession}
                onValueChange={(next) => set("cardsPerSession", next)}
              />
            </Field>

            <SelectField
              label="The mix"
              value={settings.mixMode}
              onValueChange={(next) => set("mixMode", next)}
              options={MIX_MODES}
            />

            {settings.mixMode === "explicit" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Links per session">
                  <NumberBox
                    min={0}
                    max={30}
                    value={settings.mixLinks}
                    onValueChange={(next) => set("mixLinks", next)}
                  />
                </Field>
                <Field label="Questions per session">
                  <NumberBox
                    min={0}
                    max={30}
                    value={settings.mixQuestions}
                    onValueChange={(next) => set("mixQuestions", next)}
                  />
                </Field>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New questions per session" hint="Stops a big deck drowning reviews.">
                <NumberBox
                  min={0}
                  max={30}
                  value={settings.maxNewQuestions}
                  onValueChange={(next) => set("maxNewQuestions", next)}
                />
              </Field>
              <Field label="New links per session">
                <NumberBox
                  min={0}
                  max={30}
                  value={settings.maxNewLinks}
                  onValueChange={(next) => set("maxNewLinks", next)}
                />
              </Field>
            </div>

            <Field
              label="Target retention"
              hint="How much you want to remember. Higher means more reviews."
            >
              <SliderBox
                min={0.8}
                max={0.95}
                step={0.01}
                value={settings.requestRetention}
                onValueChange={(next) => set("requestRetention", next)}
              />
              <span className="text-muted-foreground text-xs">
                {Math.round(settings.requestRetention * 100)} percent
              </span>
            </Field>

            <Field label="Quiet hours" hint="Nothing is sent during these.">
              <div className="flex items-center gap-2">
                <TimeBox
                  value={settings.quietHours?.start ?? "22:00"}
                  onValueChange={(next) =>
                    set("quietHours", {
                      start: next,
                      end: settings.quietHours?.end ?? "07:00",
                    })
                  }
                />
                <span className="text-muted-foreground text-xs">to</span>
                <TimeBox
                  value={settings.quietHours?.end ?? "07:00"}
                  onValueChange={(next) =>
                    set("quietHours", {
                      start: settings.quietHours?.start ?? "22:00",
                      end: next,
                    })
                  }
                />
                {settings.quietHours ? (
                  <Button tone="ghost" onClick={() => set("quietHours", null)}>
                    Off
                  </Button>
                ) : null}
              </div>
            </Field>

            <Button tone="primary" disabled={busy} onClick={save} fullWidth>
              {busy ? "Saving" : "Save"}
            </Button>
          </Card>
        ) : null}

        {tab === "links" ? (
          <Card className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              A link heads for the exit when you have put it off this many times, ignored it this
              many sessions, or left it unread this long. It then gets one last showing before it
              expires. Nothing is ever deleted.
            </p>

            <SwitchField
              label="Let links expire"
              checked={settings.expiryEnabled}
              onCheckedChange={(next) => set("expiryEnabled", next)}
            />

            {settings.expiryEnabled ? (
              <>
                <Field label="Snoozes before last chance">
                  <NumberBox
                    min={1}
                    max={50}
                    value={settings.expiryMaxSnoozes}
                    onValueChange={(next) => set("expiryMaxSnoozes", next)}
                  />
                </Field>
                <Field label="Sessions ignored before last chance">
                  <NumberBox
                    min={1}
                    max={50}
                    value={settings.expiryMaxIgnored}
                    onValueChange={(next) => set("expiryMaxIgnored", next)}
                  />
                </Field>
                <Field
                  label="Days unread before last chance"
                  hint="Imported links count from the import, not the original save."
                >
                  <NumberBox
                    min={7}
                    max={3650}
                    value={settings.expiryUnreadDays}
                    onValueChange={(next) => set("expiryUnreadDays", next)}
                  />
                </Field>
              </>
            ) : null}

            <Button tone="primary" disabled={busy} onClick={save} fullWidth>
              {busy ? "Saving" : "Save"}
            </Button>
          </Card>
        ) : null}

        {tab === "notifications" ? (
          <Card className="flex flex-col gap-4">
            <ChannelRow
              name="Web push"
              configured
              body="Install Aeyhey to your home screen or desktop, then turn this on. On iPhone it has to be added to the home screen first."
              channel="push"
            />
            <ChannelRow
              name="Telegram"
              configured={channels.telegramConfigured}
              connected={channels.telegramConnected}
              body={
                channels.telegramConfigured
                  ? "One message per card, each with its own buttons. Reply to a question to have it graded."
                  : "Set TELEGRAM_BOT_TOKEN in your environment and restart to turn this on."
              }
              channel="telegram"
            />
            <ChannelRow
              name="Email"
              configured={channels.emailConfigured}
              body={
                channels.emailConfigured
                  ? "One mail per session. Link cards have buttons that work without opening the app."
                  : "Set SMTP_URL in your environment and restart to turn this on."
              }
              channel="email"
            />
          </Card>
        ) : null}

        {tab === "ai" ? (
          <Card className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Aeyhey needs a model for three jobs: summarizing links, writing questions and grading
              answers. Without one, links still save and you can write questions yourself.
            </p>
            {isLocked("ai.provider") ? (
              <Notice tone="info">
                The AI provider is set in the environment, so it cannot be changed here.
              </Notice>
            ) : null}
            {flags.ollama ? (
              <p className="text-muted-foreground text-sm">
                For a fully local setup, run Ollama and point Aeyhey at it. Nothing leaves your
                machine that way.
              </p>
            ) : null}
            <a href="/settings/ai" className="text-primary text-sm font-semibold underline">
              Set up a provider
            </a>
          </Card>
        ) : null}

        {tab === "data" ? (
          <Card className="flex flex-col gap-4">
            <SwitchField
              label="Remove emails and phone numbers from my resume before it goes to a hosted model"
              description="Recommended. With Ollama there is nothing to strip for, since nothing leaves the machine."
              checked={settings.stripPii}
              onCheckedChange={(next) => set("stripPii", next)}
            />

            <Button tone="primary" disabled={busy} onClick={save} fullWidth>
              {busy ? "Saving" : "Save"}
            </Button>

            <div className="border-border flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-semibold">Export</p>
              <p className="text-muted-foreground text-xs">
                Everything as JSON, with no secrets in it. This is a portable backup.
              </p>
              <a href="/api/export" className="text-primary text-sm font-semibold underline">
                Download my data
              </a>
            </div>

            {accountHref ? (
              <div className="border-border flex flex-col gap-2 border-t pt-4">
                <p className="text-sm font-semibold">Delete account</p>
                <p className="text-muted-foreground text-xs">
                  Removes every link, deck, review and upload, then your account and sign-in. It
                  cannot be undone, so download your data first.
                </p>
                <a href={accountHref} className="text-danger text-sm font-semibold underline">
                  Delete my account
                </a>
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "data" ? <SignedInApps /> : null}
      </Columns>
    </Page>
  );
}

function ChannelRow({
  name,
  configured,
  connected = false,
  body,
  channel,
}: {
  name: string;
  configured: boolean;
  connected?: boolean;
  body: string;
  channel: "push" | "telegram" | "email";
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      await apiClient.post("/api/notifications/test", { channel });
      setResult({ ok: true, message: "Sent. Check that it arrived." });
    } catch (thrown) {
      setResult({
        ok: false,
        message: thrown instanceof ApiRequestError ? thrown.message : "That did not send.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{name}</span>
        {configured ? (
          <Button tone="ghost" disabled={busy} onClick={test}>
            {busy ? "Sending" : "Test"}
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">Not set up</span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{body}</p>
      {result ? <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice> : null}
      {channel === "telegram" && configured ? (
        <a href="/settings/notifications" className="text-primary text-xs font-semibold underline">
          {connected ? "Connected · Manage" : "Connect Telegram"}
        </a>
      ) : null}
    </div>
  );
}
