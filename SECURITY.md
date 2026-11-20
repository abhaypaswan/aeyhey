# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting instead: go to the
[Security tab](https://github.com/abhaypaswan/aeyhey/security/advisories/new) of this repository
and open a draft advisory. It is private between you and the maintainer.

Tell us what you found, how to reproduce it, and what an attacker could do with it. A proof of
concept helps a lot. If you are not sure whether something counts, report it anyway.

## What to expect

- We aim to reply within 5 days.
- We will confirm the problem, agree on a fix, and tell you when a release goes out.
- We will credit you in the release notes unless you prefer otherwise.

## Supported versions

Aeyhey is pre-1.0. Only the latest release gets security fixes. Self-hosters should run the
latest tag.

## Scope

In scope:

- The Aeyhey web app and worker in this repository.
- Our Docker images and compose files.
- Anything that lets one user read or change another user's data.
- Server side request forgery through link fetching, prompt injection that causes an action,
  secrets leaking into logs or responses, auth bypass, and stored or reflected XSS.

Out of scope:

- Problems in your own deployment, for example running with `AUTH_MODE=none` on a public network
  or exposing the app without HTTPS. The README says what each setting means.
- Issues in third party AI providers or Telegram.
- Findings that need `FETCH_ALLOW_PRIVATE=true`, which is documented as a trusted-network option.
- Denial of service through very large inputs on a self-hosted single-user instance.

## Things worth knowing when you test

- API keys entered in the UI are encrypted with AES-256-GCM using a key derived from `APP_SECRET`.
- Link fetching resolves DNS first and blocks private, loopback, link-local and metadata ranges.
- Page text, resumes and user answers are treated as data. AI output is validated with Zod and
  never triggers an action.
