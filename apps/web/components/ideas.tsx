// SPDX-License-Identifier: AGPL-3.0-only
// What to do when there is nothing to review: a few things to start, each a tile that
// opens Home with the assistant's box already filled in. Used on Home when nothing is due
// and on the session screen when there is nothing to show.

import { ArrowUpRight, Briefcase, Link2, Sparkles } from "lucide-react";
import { soft, strong, type Hue } from "../lib/hue";
import { cx } from "./ui";

const IDEAS: { title: string; body: string; say: string; icon: typeof Link2; hue: Hue }[] = [
  {
    title: "Save a link",
    body: "Paste something you meant to read",
    say: "https://",
    icon: Link2,
    hue: "blue",
  },
  {
    title: "Learn a topic",
    body: "Name it and get a deck of questions",
    say: "Make a deck on ",
    icon: Sparkles,
    hue: "violet",
  },
  {
    title: "Prepare for an interview",
    body: "Questions on the role you want",
    say: "Make interview questions for ",
    icon: Briefcase,
    hue: "teal",
  },
];

export function IdeaTiles({ className }: { className?: string }) {
  return (
    <ul className={cx("grid gap-2.5 sm:grid-cols-3", className)}>
      {IDEAS.map((idea) => (
        <li key={idea.title} className="min-w-0">
          <a
            href={`/?say=${encodeURIComponent(idea.say)}`}
            className="idea-tile group flex h-full min-w-0 items-center gap-3 rounded-[18px] p-3.5 text-left sm:flex-col sm:items-stretch sm:p-4"
            style={{ background: soft(idea.hue) }}
          >
            {/* A row on a phone, a small card from tablet width up. */}
            <span className="flex shrink-0 items-center justify-between">
              <span
                className="grid size-9 place-items-center rounded-full"
                style={{ background: strong(idea.hue), color: "white" }}
              >
                <idea.icon size={17} aria-hidden="true" />
              </span>
              <Arrow hue={idea.hue} className="hidden sm:block" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-display text-[16.5px] font-[620] leading-[1.2]">
                {idea.title}
              </span>
              <span className="text-muted-foreground text-[13.5px] leading-[1.35]">
                {idea.body}
              </span>
            </span>
            <Arrow hue={idea.hue} className="shrink-0 sm:hidden" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function Arrow({ hue, className }: { hue: Hue; className?: string }) {
  return (
    <ArrowUpRight
      size={17}
      aria-hidden="true"
      className={cx(
        "transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5",
        className,
      )}
      style={{ color: strong(hue) }}
    />
  );
}
