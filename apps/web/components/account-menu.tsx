"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Everything about you, behind your picture at the right of the top bar.
//
// The phone app keeps the same things in a sheet: who you are, when the next reminder
// comes (with Pause right there), then Stats and Settings. On a wide
// screen it opens as a panel under the picture; on a small touch screen UI SDK turns the
// same popover into a sheet, so a phone browser gets what the app gives.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  ChartLine,
  ChevronRight,
  LogOut,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import { Button } from "@ui-sdk/react/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import { apiClient, ApiRequestError } from "../lib/client";
import type { LucideIcon } from "./icons";
import { PLUGIN_ICONS, type ShellData } from "./nav";
import { cx } from "./ui";

const PAUSE_CHOICES: { label: string; body: { days: number } | { indefinite: true } }[] = [
  { label: "1 day", body: { days: 1 } },
  { label: "3 days", body: { days: 3 } },
  { label: "1 week", body: { days: 7 } },
  { label: "2 weeks", body: { days: 14 } },
  { label: "30 days", body: { days: 30 } },
  { label: "Until I turn them back on", body: { indefinite: true } },
];

/**
 * A round picture, or the first letter of the name on the theme colour, as the phone
 * draws it.
 */
export function UserAvatar({
  name,
  url,
  size,
}: {
  name: string | null;
  url: string | null;
  size: number;
}) {
  const initial = (name ?? "A").trim().charAt(0).toUpperCase() || "A";
  return (
    <Avatar
      aria-hidden="true"
      className="block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      {url ? <AvatarImage src={url} alt="" className="size-full object-cover" /> : null}
      <AvatarFallback
        className="text-primary-foreground grid size-full place-items-center font-bold"
        style={{
          fontSize: Math.round(size * 0.42),
          background:
            "linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary), light-dark(black, white) 25%))",
        }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

export function AccountMenu({ data }: { data: ShellData }) {
  const router = useRouter();
  const [choosingPause, setChoosingPause] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = data.nextSession === null;

  async function call(path: string, body: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(path, body);
      setChoosingPause(false);
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await apiClient.post("/api/auth/logout");
    } finally {
      window.location.href = "/login";
    }
  }

  const rows: { href: string; label: string; detail: string; icon: LucideIcon | null }[] = [
    {
      href: "/stats",
      label: "Stats",
      detail: "Your week, your accuracy, your streak",
      icon: ChartLine,
    },
    ...(data.extraNav ?? []).map((item) => ({
      href: item.href,
      label: item.label,
      detail: item.detail ?? "",
      icon: PLUGIN_ICONS[item.icon ?? ""] ?? null,
    })),
    {
      href: "/settings",
      label: "Settings",
      detail: "Reminders, session size, AI and theme",
      icon: SlidersHorizontal,
    },
  ];

  return (
    <Popover
      presentation="auto"
      onOpenChange={(open) => {
        if (!open) {
          setChoosingPause(false);
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        aria-label="Account"
        className="bg-quiet/90 hover:ring-border-strong grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-transparent transition-shadow"
      >
        <UserAvatar name={data.name} url={data.avatarUrl} size={36} />
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        className="account-panel flex flex-col gap-4"
      >
        <div className="flex items-center gap-3.5">
          <UserAvatar name={data.name} url={data.avatarUrl} size={56} />
          <div className="flex min-w-0 flex-1 flex-col">
            <PopoverTitle className="font-display truncate text-[22px] font-semibold leading-tight">
              {data.name ?? "You"}
            </PopoverTitle>
            <p className="text-muted-foreground truncate text-sm">Signed in to {data.host}</p>
          </div>
          <a
            href="/settings?tab=profile"
            aria-label="Edit your name and picture"
            className="text-muted-foreground hover:bg-quiet hover:text-foreground grid size-9 place-items-center rounded-full transition-colors"
          >
            <Pencil size={18} aria-hidden="true" />
          </a>
        </div>

        <section
          aria-label="Reminders"
          className="border-primary/15 rounded-2xl border p-3.5"
          style={{
            background: "color-mix(in srgb, var(--color-surface), var(--color-primary) 6%)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-full">
              {paused ? (
                <BellOff size={18} aria-hidden="true" />
              ) : (
                <Bell size={18} aria-hidden="true" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-muted-foreground text-xs">
                {paused ? "Reminders" : "Next reminder"}
              </span>
              <span className="font-display truncate text-[17px] font-semibold leading-snug">
                {paused ? "Paused" : data.nextSession}
              </span>
              <span className="text-muted-foreground text-xs">{data.rhythm}</span>
            </div>
            {paused ? (
              <Button
                disabled={busy}
                onClick={() => void call("/api/settings/resume", {})}
                className="quiet-pill"
              >
                Turn on
              </Button>
            ) : (
              <Button
                disabled={busy}
                aria-expanded={choosingPause}
                onClick={() => setChoosingPause((open) => !open)}
                className="quiet-pill"
              >
                Pause
              </Button>
            )}
          </div>

          {choosingPause ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PAUSE_CHOICES.map((choice) => (
                <Button
                  key={choice.label}
                  disabled={busy}
                  onClick={() => void call("/api/settings/pause", choice.body)}
                  className="quiet-chip"
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-danger mt-2 text-xs">{error}</p> : null}
        </section>

        <ul className="border-border flex flex-col overflow-hidden rounded-2xl border">
          {rows.map((row, index) => (
            <li key={row.href}>
              <a
                href={row.href}
                className={cx(
                  "hover:bg-quiet flex items-center gap-3.5 px-3.5 py-3 transition-colors",
                  index > 0 && "border-border border-t",
                )}
              >
                <span className="text-foreground grid w-6 shrink-0 place-items-center">
                  {row.icon ? <row.icon size={20} aria-hidden="true" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-medium">{row.label}</span>
                  {row.detail ? (
                    <span className="text-muted-foreground truncate text-[13px]">{row.detail}</span>
                  ) : null}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="text-subtle-foreground" />
              </a>
            </li>
          ))}
        </ul>

        {data.canSignOut ? (
          <Button
            onClick={() => void signOut()}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground flex items-center gap-3 self-start rounded-full px-3 py-1.5 text-[15px]"
          >
            <LogOut size={18} aria-hidden="true" />
            Sign out
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
