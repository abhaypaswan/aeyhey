<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# The Aeyhey API, for apps

The web app is one client of this API. A phone app, a script or anything else can be
another. Every feature the web app has goes through the same endpoints.

- **Spec:** [`docs/api/openapi.json`](api/openapi.json), OpenAPI 3.0. Generate a client
  from it (for Dart: `openapi-generator generate -g dart-dio`).
- **Base path:** `/api/v1`. Use this one from apps.
- **Format:** JSON in and out. Every error looks like
  `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`. The `message` is
  written for a person and is safe to show as it is.

## Signing in from an app

Apps never handle the password. They borrow the website's sign-in, so whatever sign-in the
instance offers (password, magic link, Google) works in the app too.

1. Make a random `code_verifier` (43 to 128 characters) and its
   `code_challenge = base64url(sha256(code_verifier))`. Keep the verifier on the device.
2. Open this in the system browser (`ASWebAuthenticationSession` on iOS, Custom Tabs on
   Android, `flutter_web_auth_2` in Flutter):

   ```
   https://<instance>/connect?redirect_uri=aeyhey://auth
     &code_challenge=<challenge>&code_challenge_method=S256
     &device_name=<"Pixel 8">&state=<random>
   ```

3. The person signs in if they need to and taps **Allow**. The browser goes to
   `aeyhey://auth?code=<code>&state=<state>`. Check that `state` matches.
4. Trade the code within 5 minutes:

   ```http
   POST /api/v1/auth/token
   { "grantType": "authorization_code", "code": "...", "codeVerifier": "...",
     "redirectUri": "aeyhey://auth" }
   ```

   The answer has `token` (starts with `ahy_`), `expiresAt` (a year) and `user`.

5. Store the token in the keychain or keystore and send it on every request:
   `Authorization: Bearer ahy_...`.

A 401 means the token was revoked or has expired: send the person through `/connect`
again. `POST /api/v1/auth/logout` with the token revokes it. People can see and sign out
apps in **Settings > Data > Signed-in apps**.

Codes are single use. A wrong verifier also uses one up.

### Allowed redirects

`/connect` only sends codes to redirects in `API_REDIRECT_URIS` (comma separated, matched
exactly). Unset, that is `aeyhey://auth`.

## Push reminders on phones

After signing in, and whenever the platform gives the app a new push token:

```http
POST /api/v1/devices
{ "platform": "ios" | "android", "pushToken": "...", "appVersion": "1.2.0" }
```

`pushEnabled` in the answer says whether this instance can actually send to phones. That
needs a plugin that provides a `NativePushSender` (see `@aeyhey/core/extensions`), because
sending goes through the app publisher's own Firebase or APNs account. The community build
has none, so reminders there go by web push, Telegram or email.

On sign out, call `DELETE /api/v1/devices` with the same `pushToken`. Revoking a token also
removes the devices that signed in with it.

A push message carries `path` (for example `/session`), which the app maps to a screen.

## The home screen

`GET /api/v1/today` returns what is due, the next reminder (`nextSessionAt`, plus a ready
label in the person's timezone), the streak, the next 7 days and the links up next. The
web Today page reads the same function, so the two never disagree.

## Links

Every link from `GET /api/v1/links` and `GET /api/v1/links/{id}` carries `lifeLeft`, a
number from 0 to 1: how much of its life it has left before the expiry rules send it to
Last chance. 1 is just saved, 0 is expired, and a link on its Last chance reports 0.05.
It is null when the link does not expire (read, dropped, or expiry turned off).

## Decks and questions

Aeyhey writes the questions. People never write their own or ask for more; they can only
remove one (`DELETE /api/v1/questions/{id}`), and a removed question is never asked or
written again.

- A new deck's first batch goes straight in: kept, each with a card, nothing to review.
- Shortly before each reminder, Aeyhey tops up to the person's `maxNewQuestions` setting
  (unseen question cards across all decks), giving the shortfall to the decks with the
  fewest unseen first. The reminder says when it holds new questions, for example
  "5 cards ready, 3 of them new questions on Physics."
- `GET /api/v1/decks/{id}` returns `topics` (`[{ "name", "details" }]`, empty for resume,
  document and manual decks) and `nextQuestionsLabel` ("Tomorrow at 09:00", or null when
  reminders are paused or Aeyhey does not write for that deck).
- `PATCH /api/v1/decks/{id}` takes `name`, `topicDetails` (`{ "Physics": "Class 11 CBSE" }`,
  each trimmed, at most 500 characters, `""` clears one), or both. A topic the deck does
  not have is a 400 `unknown_topic`. The details go into every later batch for that topic.
  The answer is `{ "deck", "topics" }`, with `deck` shaped like a `GET /decks` item.

## Versioning

`/api/v1` is a promise to apps already installed on phones, which can be months old.

- Adding an endpoint, or a field to a response, is fine in v1.
- Removing or renaming a field, changing what one means, or making a request field
  required is a breaking change. Do it under `/api/v2` and keep v1 working.

## Changing the API

Add the endpoint to `packages/core/src/api/manifest.ts`, then run `pnpm api:spec`. A test
fails if a route file is missing from the manifest or the committed spec is out of date.

Request bodies are exact, because they come from the Zod schemas the server validates
with. Most response bodies show as a plain object; an entry with a `response` schema in
the manifest is described in full (the links and deck endpoints so far).
