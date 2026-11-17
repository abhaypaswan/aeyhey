// SPDX-License-Identifier: AGPL-3.0-only
// The frame for the two screens that come before the app: first run and sign in.
//
// Someone landing here may never have seen Aeyhey, so on a wide screen the form shares
// the page with a short account of what the app is and how it works. On a phone the form
// comes first and the explanation is left out, because a password field is all that is
// needed to get in.

import type { ReactNode } from "react";
import { HOW_IT_WORKS_STEPS } from "./how-it-works-steps";
import { BrandMark } from "./nav";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section
        aria-label="About Aeyhey"
        className="border-border bg-surface hidden flex-col justify-between gap-10 border-r p-12 lg:flex xl:p-16"
      >
        <div className="flex items-center gap-3 text-lg font-extrabold">
          <BrandMark size="lg" />
          Aeyhey
        </div>

        <div className="flex max-w-xl flex-col gap-8">
          <div className="flex flex-col gap-3">
            <p className="text-4xl font-extrabold tracking-tight">
              Stop hoarding links. Start remembering them.
            </p>
            <p className="text-muted-foreground text-lg">
              Your saved links and your interview prep, brought back at the right time, one card at
              a time.
            </p>
          </div>

          <ol className="flex flex-col gap-5">
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="bg-primary-soft text-primary grid size-9 shrink-0 place-items-center rounded-xl font-extrabold">
                  {index + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-bold">{step.title}</span>
                  <span className="text-muted-foreground text-sm">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-subtle-foreground text-sm">
          Open source and self-hosted. Your data stays on this machine.
        </p>
      </section>

      <main className="mx-auto flex w-full max-w-md flex-col justify-center gap-5 px-4 py-10 sm:px-6">
        <div className="flex items-center justify-center gap-2.5 text-base font-extrabold lg:hidden">
          <BrandMark />
          Aeyhey
        </div>
        {children}
      </main>
    </div>
  );
}
