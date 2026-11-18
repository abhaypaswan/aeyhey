"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The app shell: one top bar, the same on every screen size.
//
// Two places matter day to day: Home, which holds the session, the decks and the
// assistant, and Inbox. They sit in a row of pill tabs. Everything about you (stats, journal, your page,
// settings, reminders) lives behind your picture on the right. On a wide screen the bar
// also carries search, because a keyboard is there. Adding is done where it belongs:
// Home's box takes a link or a topic, and Search offers Add links from anywhere.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Coins, UserRound } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { AccountMenu } from "./account-menu";
import { Search } from "./icons";
import type { LucideIcon } from "./icons";
import { Kbd, cx } from "./ui";

export interface ShellData {
  /** Cards in the next session, capped at the session size. */
  due: number;
  /** Links still waiting on a decision. */
  waiting: number;
  decks: number;
  /** "Tomorrow at 09:00", or null while reminders are paused. */
  nextSession: string | null;
  /** "5 cards a session". */
  rhythm: string;
  name: string | null;
  /** Where the person's picture is, or null with none. */
  avatarUrl: string | null;
  /** The host the person is signed in to, as the account menu says it. */
  host: string;
  /** False when the app runs without sign-in (AUTH_MODE=none). */
  canSignOut: boolean;
  /** Links a plugin adds to the account menu, such as a hosted edition's Credits page. */
  extraNav?: { href: string; label: string; icon?: string }[];
}

/** Icons a plugin may name for its links. Anything else gets no icon of its own. */
export const PLUGIN_ICONS: Record<string, LucideIcon> = { coins: Coins, user: UserRound };

/**
 * The session is one card and its actions; setup and login have nowhere to go yet; a
 * public page (/u/) is for visitors, so its owner sees it the way they do.
 */
const BARE_ROUTES = ["/session", "/setup", "/login", "/u/"];

export const OPEN_PALETTE_EVENT = "aeyhey:open-palette";

const TABS = [
  { href: "/", label: "Home", wideOnly: false },
  { href: "/inbox", label: "Inbox", wideOnly: false },
];

function activeTab(pathname: string): string | null {
  if (pathname === "/") return "/";
  if (/^\/(inbox|links|add)/.test(pathname)) return "/inbox";
  // Decks live on Home now; a deck's own page counts as part of Home.
  if (pathname.startsWith("/decks")) return "/";
  if (pathname.startsWith("/map")) return "/map";
  return null;
}

export function ShellFrame({ children, data }: { children: ReactNode; data: ShellData }) {
  const pathname = usePathname();
  if (BARE_ROUTES.some((path) => pathname.startsWith(path))) return <>{children}</>;

  const active = activeTab(pathname);
  const openPalette = (): void => {
    window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-canvas/80 sticky top-0 z-30 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:gap-5 lg:px-8">
          <a
            href="/"
            aria-label="Aeyhey, go to Home"
            className="font-display hidden shrink-0 items-center gap-2 text-lg font-semibold tracking-tight lg:flex"
          >
            <BrandMark />
            aeyhey
          </a>

          <nav aria-label="Main" className="min-w-0">
            <ul className="bg-quiet/90 flex items-center rounded-full p-1">
              {TABS.map((tab) => {
                const selected = active === tab.href;
                return (
                  <li key={tab.href} className={tab.wideOnly ? "hidden lg:block" : undefined}>
                    <a
                      href={tab.href}
                      aria-current={selected ? "page" : undefined}
                      className={cx(
                        "block rounded-full px-[15px] py-2 text-[13.5px] font-semibold leading-none transition-colors duration-200",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              onClick={openPalette}
              aria-keyshortcuts="Meta+K Control+K"
              aria-label="Search your links, or jump anywhere"
              className="text-muted-foreground hover:text-foreground bg-quiet/90 flex h-9 min-w-9 items-center justify-center gap-2 rounded-full px-2.5 text-sm transition-colors md:w-64 md:justify-start md:px-3.5"
            >
              <Search size={16} aria-hidden="true" className="shrink-0" />
              <span className="hidden truncate md:inline">Search</span>
              <span aria-hidden="true" className="ml-auto hidden md:inline">
                <Kbd>⌘K</Kbd>
              </span>
            </Button>
            <AccountMenu data={data} />
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
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
