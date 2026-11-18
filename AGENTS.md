<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Working on Aeyhey

## UI SDK

`apps/web` builds its interface on UI SDK (`@ui-sdk/react` + `@ui-sdk/core`). Before
touching anything in `apps/web/components`, follow the `ui-sdk` skill if it is installed
and read `node_modules/@ui-sdk/react/docs/llms.txt`, then the page for each component you
use. To build a component UI SDK does not ship, search
`node_modules/@ui-sdk/react/docs/core.md` by heading and read `rendering.md` next to it.

Two things about this project in particular, both of which cost an afternoon to find:

- **A `div` with `role="tablist"`, `role="dialog"`, `role="listbox"` or `role="switch"` is
  a bug here.** UI SDK ships those, with the keyboard and ARIA already right.
- **Layer order is not ours to set.** UI SDK's React components inject two `<style>` tags
  at runtime that open `@layer ui-sdk`, and those land ahead of `globals.css`, so the
  browser sorts `ui-sdk` below every Tailwind layer no matter what the `@layer` statement
  in `globals.css` says. Tailwind's preflight therefore strips the background, border and
  radius off `button`, `input`, `select` and `textarea`, which is exactly what UI SDK's
  form components render. So style UI SDK parts from the unlayered block at the bottom of
  `globals.css`, by `data-slot`, where they win whatever the order turns out to be. The
  long version is in the comment at the top of that file.

Lightning CSS, which Tailwind v4 compiles with, also drops `:has()` rules at this
project's browser targets. Reach for a class instead.

## The local demo library

`pnpm demo:local` runs the app, and the job worker beside it, on http://localhost:3000
against a demo library kept in
`data/demo/` (git-ignored, so it survives restarts and is never committed). It seeds once
and then keeps whatever you do to it. `pnpm demo:local:reset` wipes it and seeds again.

The library is `packages/core/src/seed/` (`data.ts` and `library.ts`): links and decks
across backend engineering, a book, class 11 physics, organic chemistry and language
models, with review history and graded answers, so every screen has learned, due, weak
and strong things to show. Use it to try and to demo every new feature. When a feature
needs data the library does not have, add it there rather than clicking it in by hand,
so the next reset still has it.

## A fresh instance, without the demo

`pnpm local:fresh` runs the same app with no demo data and sign-in on, from `data/fresh/`
(also git-ignored), so it opens on account creation the way a new person sees it.
`pnpm local:fresh:reset` wipes it to start over. No AI provider is set, as on a real
first run; prefix `AI_PROVIDER=mock` to try saving links and writing questions without a
key. The switch between the two is `DEMO_MODE`: true seeds the demo library, uses the
mock AI and turns sign-in off.

## The rules that do not bend

- **No em dashes** anywhere: code comments, UI copy, docs, commit messages.
- **Every source file carries an SPDX header.** `pnpm check:spdx` enforces it.
- **FSRS lives in one file.** Every call goes through
  `packages/core/src/scheduler/scheduler.ts`; an ESLint rule stops imports anywhere else.
- **Every query is scoped by user.** The repository layer takes a `Scope` and will refuse
  a call without one.
- **The public package never depends on the private one.** The dependency runs one way.

## Before you say you are done

```bash
pnpm check:all   # format, lint, SPDX, types, 298 unit and integration tests
pnpm build       # e2e runs against this build, so build before testing
pnpm test:e2e    # 40 Playwright tests, against demo mode
```

One trap: `pnpm test:e2e` serves the last `pnpm build`, not your working tree, so a run
straight after an edit tests the old code and fails in ways that make no sense. Build
first. The whole run also shares one throwaway database and the projects run in order, so
a test that acts on a session may find nothing left for the next one; restore what you
consume, or open a fresh session.
