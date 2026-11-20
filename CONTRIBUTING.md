# Contributing to Aeyhey

Thanks for wanting to help. Aeyhey is a small project, so a short issue or a focused pull request
goes a long way.

## Contributor License Agreement

Before your first pull request can be merged, you need to sign our Contributor License Agreement
(CLA). It takes one comment: a bot will reply on your PR with a link to [CLA.md](CLA.md) and the
exact sentence to post. You keep the copyright in your work. The CLA gives Abhay Paswan, who
maintains Aeyhey, permission to use and relicense your contribution. This matters because Aeyhey
is AGPL-3.0, and there is also a hosted edition that may include your code under different terms.
You only sign once, and it covers all your future contributions to this project.

## Before you start

- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Look for issues labeled `good first issue` and `help wanted`.
- Please do not send pull requests that only reformat code or bump dependencies without a reason.

## Dev setup

You need Node 22 or newer and pnpm 9 or newer.

```bash
git clone https://github.com/abhaypaswan/aeyhey && cd aeyhey
pnpm install
cp .env.example .env     # optional, the defaults work
pnpm db:migrate
pnpm dev                 # web app on http://localhost:3000
pnpm dev:worker          # in a second terminal, for jobs and reminders
```

No API key? Run with `DEMO_MODE=true` in your `.env`. That loads seed data and uses the mock AI
provider, so nothing hits the network.

Prefer local models? Install [Ollama](https://ollama.com), then set `AI_PROVIDER=ollama` and
`OLLAMA_BASE_URL=http://localhost:11434`.

## Project layout

```
packages/core/          @aeyhey/core, all the feature code
  src/db/               Drizzle schema, client, migrations
  src/scheduler/        every FSRS call lives here, nothing else computes due dates
  src/links/            normalize, extract urls, fetch and extract, AI enrichment, imports
  src/questions/        resume parsing, profile, generation, grading, dedupe
  src/ai/               providers, rate limiter, prompts, Zod contracts, mock provider
  src/notify/           web push, Telegram, the reminder loop
  src/jobs/             the DB-backed queue, the worker and its handlers
  src/extensions/       edition flags, auth, AI credentials, usage gate and sink, plugins
  src/security/         SSRF guard, encryption, signed tokens, log redaction
apps/web/               the Next.js app: routes under app/, thin by design
  aeyhey.plugins.ts     exports [] in this repo
```

Two rules that keep the code honest:

1. **All FSRS calls go through `packages/core/src/scheduler/scheduler.ts`.** An ESLint rule blocks
   importing `ts-fsrs` anywhere else.
2. **Every query is scoped by `user_id`.** The community edition is single-user, but the code is
   multi-user correct. Use the repository helpers in `src/repos/`, which require a `userId`.

## Running tests

```bash
pnpm test            # Vitest unit and integration tests
pnpm test:watch
pnpm test:e2e        # Playwright, needs the app running
pnpm check:all       # format, lint, SPDX headers, typecheck, tests. CI runs this.
```

The highest value tests to add with a change: the scheduler, session building, URL normalization,
expiry rules, and the AI contract schemas against fixtures.

## Code style

- TypeScript with `strict: true`. No `any` without a comment saying why.
- Prettier and ESLint decide formatting. Run `pnpm format` before you commit.
- Every `.ts`, `.tsx`, `.js` and `.mjs` file under `packages/` and `apps/` starts with
  `// SPDX-License-Identifier: AGPL-3.0-only`. Run `node scripts/add-spdx.mjs` to add it, and
  `pnpm check:spdx` to check.
- **No em dashes** in code comments, UI copy or docs. Use a comma, a colon or a full stop.
- Plain, short, friendly copy. No marketing tone.

## Commit and PR style

- Commit messages in the imperative mood: "add expiry rule for ignored links".
- One topic per pull request. Small is better.
- Fill in the PR checklist. It covers the CLA, tests, secrets and em dashes.
- If you chose not to do something the docs mark as SHOULD, say why in the commit message.

## Security

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md) for how to
report privately.

## License

By contributing, you agree your work is licensed under AGPL-3.0-only and covered by
[CLA.md](CLA.md).
