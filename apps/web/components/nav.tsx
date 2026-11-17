"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The app shell: a sidebar and a top bar on a wide screen, a bottom bar on a phone.
//
// The app used to be one phone-width column with a floating pill for navigation, which
// left most of a laptop screen empty and gave a first visit nothing to orient by. The
// sidebar is the fix for both: it names every place you can go, shows the counts that
// matter beside them, and keeps "Add links" and the next reminder in view on every
// screen. On a phone the thumb still gets a bar at the bottom.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Coins, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import { Button } from "@ui-sdk/react/button";
import { HowItWorks } from "./how-it-works";
import {
  BookOpen,
  Clock,
  Inbox,
  Layers,
  NotebookPen,
  Play,
  Plus,
  Search,
  Settings,
  TrendingUp,
} from "./icons";
import type { LucideIcon } from "./icons";
import { Kbd, LinkButton, cx } from "./ui";

export interface ShellData {
  /** Cards in the next session, capped at the session size. */
  due: number;
  /** Links still waiting on a decision. */
  waiting: number;
  decks: number;
  /** "Tomorrow at 09:00", or null while reminders are paused. */
  nextSession: string | null;
  rhythm: string;
  name: string | null;
  /** Where the person's picture is, or null with none. */
  avatarUrl: string | null;
  /** Links a plugin adds to the "You" group, such as a hosted edition's Credits page. */
  extraNav?: { href: string; label: string; icon?: string }[];
}

/** Icons a plugin may name for its links. Anything else gets the settings cog. */
const PLUGIN_ICONS: Record<string, LucideIcon> = { coins: Coins, user: UserRound };

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  /** Left out of the phone's bottom bar, which has room for five. Settings links to it. */
  wideOnly?: boolean;
}

/**
 * The session is one card and its actions; setup and login have nowhere to go yet; a
 * public page (/u/) is for visitors, so its owner sees it the way they do.
 */
const BARE_ROUTES = ["/session", "/setup", "/login", "/u/"];

export const OPEN_PALETTE_EVENT = "aeyhey:open-palette";

export function ShellFrame({ children, data }: { children: ReactNode; data: ShellData }) {
  const pathname = usePathname();
  if (BARE_ROUTES.some((path) => pathname.startsWith(path))) return <>{children}</>;

  const groups: { label: string; items: NavItem[] }[] = [
    { label: "Review", items: [{ href: "/", label: "Today", icon: Play, count: data.due }] },
    {
      label: "Library",
      items: [
        { href: "/inbox", label: "Inbox", icon: Inbox, count: data.waiting },
        { href: "/decks", label: "Decks", icon: Layers, count: data.decks },
      ],
    },
    {
      label: "You",
      items: [
        { href: "/stats", label: "Stats", icon: TrendingUp },
        { href: "/journal", label: "Journal", icon: NotebookPen, wideOnly: true },
        { href: "/your-page", label: "Your page", icon: BookOpen, wideOnly: true },
        ...(data.extraNav ?? []).map((item) => ({
          href: item.href,
          label: item.label,
          icon: PLUGIN_ICONS[item.icon ?? ""] ?? Settings,
          wideOnly: true,
        })),
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ];
  const flat = groups.flatMap((group) => group.items);

  const isActive = (href: string): boolean =>
    href === "/"
      ? pathname === "/"
      : pathname.startsWith(href) || (href === "/inbox" && /^\/(links|add)/.test(pathname));

  const openPalette = (): void => {
    window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
  };

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="border-border bg-surface sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto border-r px-3 py-4 lg:flex">
        <a href="/" className="flex items-center gap-2.5 px-2 py-1 text-base font-extrabold">
          <BrandMark />
          Aeyhey
        </a>

        <LinkButton href="/add" tone="primary" icon={Plus} fullWidth>
          Add links
        </LinkButton>

        <nav aria-label="Main" className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="text-subtle-foreground text-2xs px-2.5 pb-1 font-bold uppercase tracking-[0.08em]">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold transition-colors",
                          active
                            ? "bg-primary-soft text-primary"
                            : "text-muted-foreground hover:bg-sunken hover:text-foreground",
                        )}
                      >
                        <item.icon size={16} aria-hidden="true" className="shrink-0" />
                        {item.label}
                        {item.count ? (
                          <span
                            className={cx(
                              "text-2xs ml-auto rounded-full px-2 py-px font-bold tabular-nums",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "bg-sunken text-muted-foreground",
                            )}
                          >
                            {item.count}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <a
            href="/settings"
            className="border-border bg-sunken hover:border-border-strong flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition-colors"
          >
            <span className="text-subtle-foreground flex items-center gap-1.5 text-xs font-semibold">
              <Clock size={12} aria-hidden="true" />
              {data.nextSession ? "Next reminder" : "Reminders paused"}
            </span>
            <span className="text-sm font-bold">
              {data.nextSession ?? "Until you turn them on"}
            </span>
            <span className="text-subtle-foreground text-xs">{data.rhythm}</span>
          </a>

          <a
            href="/settings?tab=profile"
            className="hover:bg-sunken flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold"
          >
            <Avatar
              aria-hidden="true"
              className="bg-primary-soft text-primary text-2xs size-7 shrink-0 overflow-hidden rounded-full font-extrabold uppercase"
            >
              {data.avatarUrl ? <AvatarImage src={data.avatarUrl} alt="" /> : null}
              <AvatarFallback>{(data.name ?? "You").slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="truncate">{data.name ?? "Add your name"}</span>
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="border-border bg-canvas/85 sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:gap-3 lg:px-10">
          <a href="/" aria-label="Aeyhey, go to Today" className="lg:hidden">
            <BrandMark />
          </a>

          <Button
            onClick={openPalette}
            aria-keyshortcuts="Meta+K Control+K"
            className="border-border bg-surface text-subtle-foreground hover:border-border-strong flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 text-sm transition-colors max-sm:justify-start lg:max-w-md"
          >
            <Search size={15} aria-hidden="true" className="shrink-0" />
            <span className="truncate max-sm:hidden">Search your links, or jump anywhere</span>
            <span className="sm:hidden">Search</span>
            <span aria-hidden="true" className="ml-auto hidden sm:inline">
              <Kbd>⌘K</Kbd>
            </span>
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <HowItWorks />
            {/* Wrapped, because the button sets its own display and would win over a
                "hidden" on the same element. */}
            <span className="lg:hidden">
              <LinkButton href="/add" icon={Plus}>
                Add
              </LinkButton>
            </span>
            <span className="hidden sm:block">
              <LinkButton href="/session" tone={data.due > 0 ? "primary" : "secondary"} icon={Play}>
                {data.due > 0 ? `Review ${data.due} now` : "Practice"}
              </LinkButton>
            </span>
          </div>
        </header>

        {children}
      </div>

      {/* The phone's navigation: fixed at the bottom, where the thumb is. */}
      <nav
        aria-label="Main, compact"
        className="border-border bg-surface/90 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
          {flat
            .filter((item) => !item.wideOnly)
            .map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href} className="flex-1">
                  <a
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors",
                      active ? "text-primary" : "text-subtle-foreground hover:text-foreground",
                    )}
                  >
                    {/* The pill behind the icon is what says "you are here" at a glance; a
                      change of text colour alone is easy to miss on a small screen. */}
                    <span
                      className={cx(
                        "relative grid h-7 w-14 place-items-center rounded-full transition-colors",
                        active && "bg-primary-soft",
                      )}
                    >
                      <item.icon size={19} aria-hidden="true" />
                      {item.count ? (
                        <span className="bg-primary text-primary-foreground absolute -top-1 right-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-bold tabular-nums leading-4">
                          {item.count}
                        </span>
                      ) : null}
                    </span>
                    {item.label}
                  </a>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );
}

/**
 * The Aeyhey mark: the letter a with its bowl drawn as an arrow coming back round, and a
 * full stop. The tile takes the chosen theme's colour (the `brand` tokens in
 * globals.css), and keeps it in light and dark alike, with a white glyph. The same drawing, as files, is in assets/logo at the repo root.
 */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "bg-brand text-brand-foreground block shrink-0 overflow-hidden",
        size === "lg" ? "size-10 rounded-[0.5625rem]" : "size-7 rounded-[0.4rem]",
      )}
    >
      <svg viewBox="0 0 64 64" className="size-full" focusable="false">
        <g transform="translate(-2.4 -1)">
          <path
            d="M41 34 A12 12 0 1 1 29 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="6.5"
            strokeLinecap="butt"
          />
          <path
            d="M29 15.5 L36.5 22 L29 28.5 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M41 21.5 V46.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="6.5"
            strokeLinecap="round"
          />
          <circle cx="51.6" cy="46" r="3.75" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
