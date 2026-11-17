"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// "How it works", one press away on every screen.
//
// Aeyhey is an unusual shape of app: not a read-later list and not a flashcard deck, but
// one queue fed by both. Someone opening it for the first time needs that said plainly,
// once, and then needs it out of the way. So the explanation lives behind a button in the
// top bar rather than taking up room on a screen people will see every day.

import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { Brain, CircleHelp, Link2 } from "./icons";
import { HOW_IT_WORKS_STEPS } from "./how-it-works-steps";

export function HowItWorks() {
  return (
    <Dialog>
      <DialogTrigger className="text-muted-foreground hover:bg-sunken hover:text-foreground inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors">
        <CircleHelp size={16} aria-hidden="true" />
        <span className="hidden md:inline">How it works</span>
        <span className="sr-only md:hidden">How it works</span>
      </DialogTrigger>
      <DialogBackdrop />
      <DialogContent className="aeyhey-dialog">
        <DialogTitle>How Aeyhey works</DialogTitle>
        <DialogDescription>
          It brings back the things you meant to learn, a few cards at a time, and schedules each
          one by how you respond.
        </DialogDescription>

        <ol className="flex flex-col gap-3">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="bg-primary-soft text-primary grid size-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold">
                {index + 1}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-bold">{step.title}</span>
                <span className="text-muted-foreground text-sm">{step.body}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-border flex flex-col gap-1 rounded-xl border p-3">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Link2 size={14} aria-hidden="true" className="text-primary" />
              Link cards
            </span>
            <span className="text-muted-foreground text-xs">
              A saved page with a short summary. You choose: Read now, Later, or Drop. Links you
              keep putting off come back less often and quietly expire.
            </span>
          </div>
          <div className="border-border flex flex-col gap-1 rounded-xl border p-3">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Brain size={14} aria-hidden="true" className="text-primary" />
              Question cards
            </span>
            <span className="text-muted-foreground text-xs">
              A question from one of your decks. Answer in your own words and get a score, or reveal
              the answer and rate how well you knew it.
            </span>
          </div>
        </div>

        <div className="flex justify-end">
          <DialogClose className="bg-primary text-primary-foreground hover:bg-primary-hover min-h-10 rounded-lg px-4 text-sm font-semibold">
            Got it
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
