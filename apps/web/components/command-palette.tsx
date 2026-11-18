"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The command palette, on Cmd+K (PRD 12, 8.3 FR-S-6).
//
// Built on UI SDK's Command inside its Dialog, which brings the parts that are tedious
// and easy to get subtly wrong: the combobox role and its aria wiring, the filtering and
// match marking, roving highlight, the dialog's focus trap, dismissal, and returning
// focus to whatever opened it.
//
// What Aeyhey supplies is the content: where you can go, a search over your own links
// that runs against the API as you type, and whatever you typed handed to aey, which is
// how anything gets added or asked now.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandItemIcon,
  CommandList,
  CommandStatus,
} from "@ui-sdk/react/command";
import { Dialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { House, Map as MapIcon, UserRound } from "lucide-react";
import { apiClient } from "../lib/client";
import { OPEN_PALETTE_EVENT } from "./nav";
import { hostOf, linkTitle } from "../lib/format";
import { Bot, Inbox, Play, Settings, Sparkles, TrendingUp, contentTypeIcon } from "./icons";

interface LinkHit {
  id: string;
  title: string | null;
  url: string;
  siteName: string | null;
  contentType?: string | null;
}

/** Hands the typed text to aey on Home. Adding a link, making a deck and asking all go
 * through aey, so one item covers them. */
const ASK = "ask";

/** Everything the palette can do, besides asking aey or opening one of your own links. */
const ACTIONS = [
  { value: "session", label: "Start a session", icon: Play, href: "/session", group: "Do" },
  {
    value: "agents",
    label: "Connect a coding agent",
    icon: Bot,
    href: "/settings?tab=agents",
    group: "Do",
    // Found by what people call it, not only by this label.
    keywords: "claude code codex cursor mcp agent",
  },
  { value: "home", label: "Home", icon: House, href: "/", group: "Go to" },
  { value: "inbox", label: "Inbox", icon: Inbox, href: "/inbox", group: "Go to" },
  { value: "profile", label: "Profile", icon: UserRound, href: "/profile", group: "Go to" },
  { value: "map", label: "Map", icon: MapIcon, href: "/map", group: "Go to" },
  { value: "stats", label: "Stats", icon: TrendingUp, href: "/stats", group: "Go to" },
  { value: "settings", label: "Settings", icon: Settings, href: "/settings", group: "Go to" },
] as const;

/** The label plus any other words an action should be found by. */
function searchableText(value: string, label: string): string {
  const action = ACTIONS.find((candidate) => candidate.value === value);
  const keywords = action && "keywords" in action ? action.keywords : "";
  return `${label} ${keywords}`.toLowerCase();
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LinkHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchToken = useRef(0);

  // Cmd+K from anywhere. The binding lives here rather than on a DialogTrigger because
  // the palette is mounted once for the whole app, apart from the button that opens it. Typing in a field is left alone, or the shortcut would eat real input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing && !open) return;

      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The search box in the top bar is the visible way in. It lives in the app shell, so it
  // asks with an event rather than reaching into this component's state.
  useEffect(() => {
    const onOpen = (): void => setOpen(true);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
  }, []);

  // Each opening starts empty, so "Ask aey" never sends what was typed last time.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Close on navigation, so the palette never lingers over the page it just opened.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Search the user's own links. Debounced, and stale replies are dropped so a slow
  // response for "po" cannot overwrite the results for "postgres".
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    const token = ++searchToken.current;
    setSearching(true);

    const timer = setTimeout(() => {
      apiClient
        .get<{ items: LinkHit[] }>(`/api/links?q=${encodeURIComponent(text)}&limit=6`)
        .then((page) => {
          if (token !== searchToken.current) return;
          setHits(page.items);
        })
        .catch(() => {
          if (token === searchToken.current) setHits([]);
        })
        .finally(() => {
          if (token === searchToken.current) setSearching(false);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  const run = useCallback(
    (value: string) => {
      if (value === ASK) {
        const text = query.trim();
        setOpen(false);
        if (!text && pathname === "/") {
          // Already on Home: just put the cursor in aey's box, once the dialog has let go.
          setTimeout(() => document.getElementById("assistant-box")?.focus(), 50);
          return;
        }
        router.push(text ? `/?ask=${encodeURIComponent(text)}` : "/#aey");
        return;
      }

      const action = ACTIONS.find((candidate) => candidate.value === value);
      if (action) {
        router.push(action.href);
        setOpen(false);
        return;
      }

      const hit = hits.find((candidate) => `link:${candidate.id}` === value);
      if (hit) {
        router.push(`/links/${hit.id}`);
        setOpen(false);
      }
    },
    [hits, pathname, query, router],
  );

  const groups = ["Do", "Go to"] as const;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogBackdrop />
      <DialogContent className="aeyhey-palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <Command
          onAction={run}
          // The query is controlled here so the link search can run against it. Its
          // change handler lives on the root, not the input.
          query={query}
          onQueryChange={setQuery}
          // Aeyhey's own link results are already filtered by the server, so they must
          // not be filtered again by the client's fuzzy match on a title it cannot see.
          // aey takes anything, so it is never filtered out either.
          filter={(item, text) =>
            item.value === ASK ||
            String(item.value).startsWith("link:") ||
            searchableText(String(item.value), String(item.label ?? "")).includes(
              text.toLowerCase(),
            )
          }
        >
          <CommandInput
            aria-label="Search commands and your links"
            placeholder="Jump to, search your links, or ask aey"
          />

          <CommandStatus>{searching ? "Searching your links" : null}</CommandStatus>
          {/* Held back while a search is in flight, so the palette does not say it found
              nothing and that it is still looking at the same time. */}
          <CommandEmpty>{searching ? null : "Nothing matches that."}</CommandEmpty>

          <CommandList>
            {groups.map((group) => (
              <CommandGroup key={group}>
                <CommandGroupLabel>{group}</CommandGroupLabel>
                {ACTIONS.filter((action) => action.group === group).map((action) => (
                  <CommandItem key={action.value} value={action.value} label={action.label}>
                    <CommandItemIcon>
                      <action.icon size={15} />
                    </CommandItemIcon>
                    {action.label}
                  </CommandItem>
                ))}
                {/* Last in Do, so a command your words match is picked first; with no
                    match it is the only thing left there, so it comes first anyway. */}
                {group === "Do" ? (
                  <CommandItem value={ASK} label="Ask aey">
                    <CommandItemIcon>
                      <Sparkles size={15} />
                    </CommandItemIcon>
                    {query.trim() ? (
                      <span className="min-w-0 truncate">
                        Ask aey <span className="font-semibold">&ldquo;{query.trim()}&rdquo;</span>
                      </span>
                    ) : (
                      "Ask aey anything"
                    )}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ))}

            {hits.length > 0 ? (
              <CommandGroup>
                <CommandGroupLabel>Your links</CommandGroupLabel>
                {hits.map((hit) => {
                  const TypeIcon = contentTypeIcon(hit.contentType);
                  return (
                    <CommandItem key={hit.id} value={`link:${hit.id}`} label={hit.title ?? hit.url}>
                      <CommandItemIcon>
                        <TypeIcon size={15} />
                      </CommandItemIcon>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{linkTitle(hit.title, hit.url)}</span>
                        <span className="text-subtle-foreground truncate text-xs">
                          {hit.siteName ?? hostOf(hit.url)}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
