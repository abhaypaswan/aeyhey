<div align="center">

<img src="assets/logo/aeyhey-mark.svg" alt="Aeyhey logo" width="96" height="96">

# Aeyhey

**Stop hoarding links. Start remembering them.**

Spaced repetition for your read-later pile and your next interview.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![CI](https://github.com/abhaypaswan/aeyhey/actions/workflows/ci.yml/badge.svg)](https://github.com/abhaypaswan/aeyhey/actions/workflows/ci.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-aeyhey-blue?logo=docker&logoColor=white)](https://github.com/abhaypaswan/aeyhey/pkgs/container/aeyhey)
[![Stars](https://img.shields.io/github/stars/abhaypaswan/aeyhey?style=flat)](https://github.com/abhaypaswan/aeyhey/stargazers)

<img src="docs/images/demo.gif" alt="A link card set aside for later, then an interview question answered and graded" width="340">

</div>

## What it does

- **Brings back the links you saved.** Paste them, and Aeyhey fetches each page, writes a 3-line
  summary and a guess at why you saved it, and shows a few per session with Read now, Remind me
  later or Drop.
- **Turns your resume or a few topics into interview questions.** With model answers, tags and
  difficulty. Answer in your own words and get a score and honest feedback on what you missed.
- **Schedules both on one engine.** FSRS, the same algorithm behind modern Anki, through
  [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs). Links you keep snoozing come back
  less often. Links you never touch quietly expire, so the pile shrinks instead of growing.

Bring your own API key (OpenAI, anything OpenAI-compatible, or Anthropic) or run it fully local
with [Ollama](https://ollama.com). One `docker compose up`. No telemetry.

## Why

Read-later tools are great at saving and terrible at returning. Pocket and Omnivore both shut
down, and the self-hosted tools people moved to are good archives: they file things away, they do
not bring them back. So the pile grows, you feel guilty about it, and eventually you declare
bankruptcy and delete the lot. The saving was never the problem.

Interview prep has the same shape. You cram for a week, you get the offer or you do not, and six
months later it is gone. Flashcard apps have the scheduling part solved, but you write every card
yourself, and generic AI question packs do not ask about the payments service you actually built.
Aeyhey starts from your resume and puts both piles on the same scheduler.

## Quick start

Try it with seed data, no API key, nothing to configure:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up
```

Open http://localhost:3000. Demo mode uses a mock AI provider, so nothing leaves your machine.

For the real thing:

```bash
git clone https://github.com/abhaypaswan/aeyhey && cd aeyhey
cp .env.example .env      # optional, works without edits
docker compose up -d
# open http://localhost:3000
```

First run walks you through a password, your timezone, an AI provider and how often you want to
hear from it. You can skip the AI step and add it later: links still save, and you can write
questions by hand.

Running from source instead? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

**Links**

- Paste one URL or five hundred, mixed in with any other text. Aeyhey finds them, normalizes
  them, and skips ones you already saved.
- Fetches articles, X posts, YouTube videos (with the transcript when there is one) and PDFs.
- 3-line summary, a "why you probably saved this" line, 1 to 5 tags, estimated read time.
- Inbox with search, status chips and tag filters. Bulk drop, restore, retag and mark read.
- Share a link into Aeyhey from your phone (installable PWA share target) or a desktop
  bookmarklet. Send a URL to the Telegram bot and it gets saved.
- Reader view for the extracted text, if you would rather not open the original.

**Questions**

- Type 1 to 10 topics, pick a level, get questions with model answers.
- Or upload your resume (PDF, DOCX or pasted text), add a target role and a job description, and
  get questions about your own projects and stack plus the standard ones for that role.
- Generated questions are kept in the deck automatically. Near-duplicates get dropped.
- Answer, Reveal, Skip, or rate Easy or Hard. Every action feeds the scheduler.
- "Generate 5 more" on a deck, "more like this" on a single card.

**Sessions and delivery**

- One card at a time, with progress. Leave halfway and pick up where you were.
- Keyboard shortcuts for everything. Undo for 10 seconds after any action.
- Daily, weekly or monthly, at a time you pick, with a card count you pick (1 to 30).
- Web push (installable PWA), a Telegram bot, or email. Each card is its own Telegram message
  with its own buttons, so you can handle them in any order.
- Stats: reviews per day, links cleared over time, score by tag, what is due for the next 30 days.

**Self-hosting**

- One Docker image runs the web app or the worker. SQLite by default, one file to back up.
  Postgres when you want it.
- Compose overrides for Ollama and Postgres. Migrations run on start.
- JSON export of everything. Restoring from that export is not available yet.

## Screenshots

| Today                                         | Link card                                         | Question with a grade                                  |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| <img src="docs/images/today.png" width="240"> | <img src="docs/images/link-card.png" width="240"> | <img src="docs/images/question-grade.png" width="240"> |

| Inbox                                         | Resume flow                                    | Public page                                         |
| --------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| <img src="docs/images/inbox.png" width="240"> | <img src="docs/images/resume.png" width="240"> | <img src="docs/images/public-page.png" width="240"> |

## How scheduling works

Aeyhey uses FSRS, a modern spaced repetition algorithm. Every card has a stability and a
difficulty, and every action you take updates them. Cards you find easy spread out fast. Cards you
get wrong come back soon. You never pick an interval yourself.

Your cadence decides when you are asked, and FSRS decides what you are asked. If you are on a
weekly cadence, cards that come due during the week wait for your next session rather than
nagging you.

**What each button does to a question card**

| What you do                | How it counts                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Answer, scored 0 to 39     | Again                                                                                                     |
| Answer, scored 40 to 64    | Hard                                                                                                      |
| Answer, scored 65 to 89    | Good                                                                                                      |
| Answer, scored 90 to 100   | Easy                                                                                                      |
| "I don't know"             | Again, and it shows you the model answer                                                                  |
| Reveal, then rate yourself | Whatever you tap                                                                                          |
| Reveal, then leave         | Hard                                                                                                      |
| Quick Easy or Quick Hard   | Easy or Hard                                                                                              |
| Skip                       | Nothing. It comes back next session. Skip three times in a row and Aeyhey asks if you want to suspend it. |

The score only suggests a rating. You can always tap a different one.

**What each button does to a link card**

| What you do     | What happens                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Read now        | It opens, and the card is done. It will not come back unless you ask for it.                                           |
| Remind me later | It comes back, and each snooze pushes it further out: roughly 3 days, then 2 weeks, then 2 months, capped at 4 months. |
| Drop            | Gone from sessions, still searchable, restorable any time.                                                             |

**How links expire**

A link starts heading for the exit when you have snoozed it 5 times, ignored it in 3 sessions, or
kept it unread for 180 days. When that happens it gets one more showing, labeled "Last chance".
Read it and it is saved. Snooze it and you buy it one more life. Ignore it and it expires.

Expired links are not deleted. They sit under "Expired", searchable, and restoring one resets it
to a fresh card. All of these numbers are settings, and you can turn expiry off completely.

Imported links get their 180 days counted from the import, not from whenever you originally saved
them, so a five year old backlog does not evaporate on day one.

## Configuration

Everything is optional. Aeyhey runs with no `.env` at all.

| Variable              | Default                 | What it does                                       |
| --------------------- | ----------------------- | -------------------------------------------------- |
| `PUBLIC_URL`          | `http://localhost:3000` | Used in push, Telegram and email links             |
| `APP_SECRET`          | generated               | Signs cookies and tokens, encrypts stored API keys |
| `DATABASE_URL`        | `file:/data/aeyhey.db`  | SQLite file, or a `postgres://` URL                |
| `DATA_DIR`            | `/data`                 | Uploads, generated secrets, the SQLite file        |
| `DEMO_MODE`           | `false`                 | Seed data and the mock AI provider                 |
| `AUTH_MODE`           | `password`              | `none` skips login, for a trusted LAN only         |
| `AI_PROVIDER`         | unset                   | `openai`, `anthropic`, `ollama` or `mock`          |
| `TELEGRAM_BOT_TOKEN`  | unset                   | Setting it turns Telegram on                       |
| `SMTP_URL`            | unset                   | Setting it turns email on                          |
| `FETCH_ALLOW_PRIVATE` | `false`                 | Lets Aeyhey fetch private network addresses        |

The full list is in [.env.example](.env.example).
Anything you set in the environment wins over the in-app settings, and the settings screen marks
those fields as locked so you are not confused about why a change did nothing.

## AI providers

Aeyhey needs a model for three jobs: summarizing links, writing questions, and grading answers.
You can use a different provider for each.

**OpenAI**

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
AI_MODEL_SUMMARY=gpt-4o-mini
AI_MODEL_GENERATE=gpt-4o
AI_MODEL_GRADE=gpt-4o-mini
```

**Any OpenAI-compatible endpoint** (OpenRouter, Groq, Together, LM Studio, vLLM)

```bash
AI_PROVIDER=openai
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-your-key-here
AI_MODEL_GENERATE=anthropic/claude-sonnet-4.5
```

**Anthropic**

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key-here
AI_MODEL_SUMMARY=claude-haiku-5-5
AI_MODEL_GENERATE=claude-sonnet-5-5
```

**Ollama, fully local**

```bash
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d
docker compose exec ollama ollama pull llama3.1:8b
```

That sets `AI_PROVIDER=ollama` for you. Summaries work well on an 8B model. Grading and question
writing are noticeably better on something larger, so use a 14B or above if your machine can take
it. Give Ollama more time than a hosted model: Aeyhey already allows 90 seconds for local grading
against 30 for hosted.

You can also enter keys in the settings screen instead of the environment. Those are encrypted at
rest with AES-256-GCM and never sent back to the browser after you save them.

## Telegram setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, and follow the two
   questions. It gives you a token.
2. Put it in your `.env` as `TELEGRAM_BOT_TOKEN` and restart: `docker compose up -d`.
3. Open Settings, Notifications, and click **Connect Telegram**. It shows a link. Open it, and the
   bot replies "Connected".

If your `PUBLIC_URL` is an https address, Aeyhey uses a webhook. If it is not, which is normal on
a home server, it uses long polling instead and works the same.

Talk to the bot the same way you talk to aey in the app. Send a link to save it, ask about what you
have saved, ask for a question deck, or ask how Aeyhey works. At send time you get one message per
card with its own buttons. Reply to a question message with your answer and the bot grades it.
Send `/login` in Telegram to connect from the bot: Aeyhey opens the normal sign-in when needed,
then asks you to approve that chat. Settings shows the current connection and lets you disconnect
it. Commands remain as optional shortcuts: `/today`, `/pause`, `/resume`, `/settings`.

## Email setup

1. Set `SMTP_URL` and `EMAIL_FROM` in your `.env`. Most providers give you a URL like
   `smtp://user:pass@smtp.example.com:587`.
2. Open Settings, Notifications, add your address, and click Send verification. Click the link in
   the mail.
3. Use Test to check it.

One mail per session. Link cards have one-tap Read now, Later and Drop buttons that work without
opening the app. Every mail has an unsubscribe link and a "pause for a week" link.

## Privacy

Everything lives in your database. There is no telemetry, no analytics, and no phone-home check.

Aeyhey makes outbound calls in exactly four cases:

1. **Fetching a link you saved.** To the site you saved, when the worker processes it.
2. **Your AI provider.** Only if you configured one. With Ollama, this never leaves your machine.
3. **Notification channels you turned on.** Telegram's API, or your own SMTP server, or the push
   service your browser uses.
4. **Nothing else.**

A few more things worth knowing:

- API keys you enter in the UI are encrypted at rest. After saving, the UI only ever shows the
  last 4 characters. They are never logged.
- Your resume file is deleted after parsing unless you tick "keep my resume file". By default only
  the extracted text and the structured profile are stored.
- Emails and phone numbers are stripped from your resume before it goes to a hosted model. That is
  on by default and explained on the upload screen. With Ollama there is nothing to strip for.
- Page text, resumes and your own answers are treated as data, never as instructions. AI output is
  validated against a schema and rendered as escaped text, and it can never trigger an action.
- Link fetching resolves DNS first and refuses private, loopback, link-local and cloud metadata
  addresses, rechecking after every redirect.
- "Delete all data" removes every row and every uploaded file.

## Self-host or hosted

Everything in this repository is the real app, free under AGPL-3.0, with nothing held back,
crippled or time-limited. If you can run Docker, you get every feature that matters for learning.

There is also a hosted version for people who would rather not run servers. It adds sign-up,
credits and managed API keys, and nothing else. Use it at [aeyhey.app](https://aeyhey.app).

## How it compares

|                                    | Aeyhey | Anki   | RemNote  | Readwise            | Karakeep / Linkwarden | Final Round AI |
| ---------------------------------- | ------ | ------ | -------- | ------------------- | --------------------- | -------------- |
| Self-hosted                        | yes    | yes    | no       | no                  | yes                   | no             |
| Brings back unread links           | yes    | no     | no       | partly (highlights) | no                    | no             |
| Questions from your resume         | yes    | no     | no       | no                  | no                    | partly         |
| AI grades your written answer      | yes    | no     | no       | no                  | no                    | yes (live)     |
| FSRS scheduling                    | yes    | yes    | yes      | no                  | no                    | no             |
| Push, Telegram and email reminders | yes    | partly | partly   | email               | no                    | no             |
| Price                              | free   | free   | freemium | paid                | free                  | paid           |

Different tools, different jobs. Anki is a better flashcard app, Karakeep is a better archive.
Aeyhey is the only one that puts an unread link and a question about your own resume on the same
scheduler.

## Roadmap

Shipped in v1: links, questions, sessions, FSRS, push, Telegram, email, Docker, demo mode.

Next, roughly in order:

- Imports: Pocket CSV, browser bookmarks HTML, Karakeep and Linkwarden JSON, X bookmarks CSV
- Embedding-based dedupe for questions
- A browser extension, so saving does not need a paste
- Per-deck cadence
- FSRS parameter optimization from your own review history
- More content extractors

## Contributing

Pull requests are welcome. Start with an issue if the change is bigger than a bug fix, and look
for `good first issue`.

```bash
pnpm install
pnpm dev          # the web app
pnpm dev:worker   # jobs and reminders, in a second terminal
pnpm test
```

The current Vitest suite has 501 passing tests in the default run. Postgres coverage adds four
query tests and activates one migration test, for 506 tests total when those suites use isolated
throwaway databases through `CORE_TEST_DATABASE_URL`.

[CONTRIBUTING.md](CONTRIBUTING.md) has the project layout, the two rules that keep the code honest,
and the one-comment CLA step.

## Credits

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) and the
  [open-spaced-repetition](https://github.com/open-spaced-repetition) project, for FSRS and for
  doing the hard research in the open.
- [Mozilla Readability](https://github.com/mozilla/readability), which does the real work of
  turning a web page into readable text.
- [Vercel AI SDK](https://sdk.vercel.ai), [Drizzle](https://orm.drizzle.team),
  [grammY](https://grammy.dev) and [shadcn/ui](https://ui.shadcn.com).

## License

Aeyhey is free and open source under the [GNU AGPL-3.0](LICENSE). You can use, self-host and
modify it. If you run a modified version as a service for other people, you must share your
changes under the same license. Contributions require signing our [CLA](CLA.md), which lets the
maintainer also offer Aeyhey as a hosted service.
