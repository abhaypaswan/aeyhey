// SPDX-License-Identifier: AGPL-3.0-only
// Every HTTP endpoint the app serves, in one list.
//
// The OpenAPI spec at docs/api/openapi.json is generated from this, and a test walks
// apps/web/app/api and fails if a route file and this list disagree. So an endpoint
// cannot ship without showing up in the spec that other clients, such as the phone app,
// generate their code from.
//
// Paths are relative to /api/v1 (or /api, which is the same thing today).

import type { ZodType } from "zod";
import { CardActionSchema } from "../sessions/actions";
import * as schemas from "./schemas";

export type ManifestMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ManifestEntry {
  method: ManifestMethod;
  /** OpenAPI style, with {id} for a path parameter. */
  path: string;
  summary: string;
  tag: string;
  /**
   * "user": a session cookie or an app token. "none": anyone. "special": its own proof,
   * such as a signed link in an email or the Telegram webhook secret.
   */
  auth: "user" | "none" | "special";
  body?: ZodType;
  /** The 200 body. Without one the spec says only "an object". */
  response?: ZodType;
  query?: readonly string[];
  /** For the browser or for other servers, not for app clients. Marked x-internal. */
  internal?: boolean;
}

const LIST_QUERY = ["limit", "cursor", "q"] as const;

export const API_MANIFEST: readonly ManifestEntry[] = [
  // ------------------------------------------------------------ auth
  {
    method: "GET",
    path: "/auth/me",
    summary: "Who is signed in, and whether the instance still needs first-run setup.",
    tag: "auth",
    auth: "none",
  },
  {
    method: "POST",
    path: "/auth/setup",
    summary: "First run only: create the owner account.",
    tag: "auth",
    auth: "none",
    body: schemas.SetupSchema,
    internal: true,
  },
  {
    method: "POST",
    path: "/auth/login",
    summary: "Sign in with a password and get a session cookie. Apps use /connect instead.",
    tag: "auth",
    auth: "none",
    body: schemas.LoginSchema,
    internal: true,
  },
  {
    method: "POST",
    path: "/auth/logout",
    summary: "Sign out. With an app token, that token is revoked.",
    tag: "auth",
    auth: "user",
  },
  {
    method: "POST",
    path: "/auth/connect",
    summary: "The Allow button on /connect. Returns where to send the browser, with a code.",
    tag: "auth",
    auth: "user",
    body: schemas.ConnectApproveSchema,
    internal: true,
  },
  {
    method: "POST",
    path: "/auth/token",
    summary: "Trade a /connect code and its PKCE verifier for an app token.",
    tag: "auth",
    auth: "none",
    body: schemas.TokenExchangeSchema,
  },
  {
    method: "GET",
    path: "/auth/tokens",
    summary: "The apps signed in to this account.",
    tag: "auth",
    auth: "user",
  },
  {
    method: "DELETE",
    path: "/auth/tokens/{id}",
    summary: "Sign one app out, and remove its push registrations.",
    tag: "auth",
    auth: "user",
  },

  // ------------------------------------------------------------ today and session
  {
    method: "GET",
    path: "/today",
    summary: "Everything the home screen shows: what is due, the next reminder, the streak.",
    tag: "session",
    auth: "user",
  },
  {
    method: "GET",
    path: "/session/current",
    summary: "The open session, built now if there is none.",
    tag: "session",
    auth: "user",
  },
  {
    method: "POST",
    path: "/session/start",
    summary: "Start a session now, optionally pulling cards early.",
    tag: "session",
    auth: "user",
    body: schemas.StartSessionSchema,
  },
  {
    method: "GET",
    path: "/session/{id}/summary",
    summary: "What happened in a finished session.",
    tag: "session",
    auth: "user",
  },
  {
    method: "POST",
    path: "/cards/{id}/actions",
    summary: "Act on a card: answer, reveal, rate, read, snooze, drop or skip.",
    tag: "session",
    auth: "user",
    body: CardActionSchema,
    query: ["sessionId"],
  },
  {
    method: "POST",
    path: "/cards/{id}/dont-know",
    summary: "Rate a question Again and show its model answer.",
    tag: "session",
    auth: "user",
  },
  {
    method: "POST",
    path: "/cards/{id}/suspend",
    summary: "Stop a card from coming up.",
    tag: "session",
    auth: "user",
  },
  {
    method: "POST",
    path: "/cards/{id}/unsuspend",
    summary: "Let a suspended card come up again.",
    tag: "session",
    auth: "user",
  },
  {
    method: "POST",
    path: "/reviews/{id}/undo",
    summary: "Undo the last action on a card.",
    tag: "session",
    auth: "user",
  },

  // ------------------------------------------------------------ links
  {
    method: "GET",
    path: "/links",
    summary: "The inbox, paged with a cursor.",
    tag: "links",
    auth: "user",
    query: [...LIST_QUERY, "status", "tag", "type", "sort"],
    response: schemas.LinkListResponseSchema,
  },
  {
    method: "POST",
    path: "/assistant",
    summary:
      "One message to the assistant. Links in it are saved; a request for questions comes back as a deck proposal to confirm through /question-sources/topics; a question is answered from the user's own library, with sources; anything ambiguous comes back with options to send again with force set.",
    tag: "links",
    auth: "user",
    body: schemas.AssistantSchema,
  },
  {
    method: "POST",
    path: "/links",
    summary: "Save links. Any text works: every URL in it is saved.",
    tag: "links",
    auth: "user",
    body: schemas.AddLinksSchema,
  },
  {
    method: "GET",
    path: "/links/{id}",
    summary: "One link.",
    tag: "links",
    auth: "user",
    response: schemas.LinkResponseSchema,
  },
  {
    method: "PATCH",
    path: "/links/{id}",
    summary: "Change a link's title, note, status or tags.",
    tag: "links",
    auth: "user",
    body: schemas.UpdateLinkSchema,
  },
  {
    method: "POST",
    path: "/links/{id}/reprocess",
    summary: "Fetch and summarise a link again.",
    tag: "links",
    auth: "user",
  },
  {
    method: "POST",
    path: "/links/bulk",
    summary: "Drop, restore, retag or mark read many links at once.",
    tag: "links",
    auth: "user",
    body: schemas.BulkLinkSchema,
  },
  {
    method: "GET",
    path: "/link-counts",
    summary: "How many links are in each status.",
    tag: "links",
    auth: "user",
  },
  {
    method: "GET",
    path: "/tags",
    summary: "Every tag in use.",
    tag: "links",
    auth: "user",
  },

  // ------------------------------------------------------------ questions
  {
    method: "GET",
    path: "/decks",
    summary: "Every deck, with counts.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "GET",
    path: "/decks/{id}",
    summary: "One deck, its questions, its topics and when its next questions are written.",
    tag: "questions",
    auth: "user",
    response: schemas.DeckDetailResponseSchema,
  },
  {
    method: "PATCH",
    path: "/decks/{id}",
    summary:
      "Rename a deck, set its topic details, or pause and resume it. The links deck keeps its name.",
    tag: "questions",
    auth: "user",
    body: schemas.RenameDeckSchema,
    response: schemas.DeckResponseSchema,
  },
  {
    method: "DELETE",
    path: "/decks/{id}",
    summary: "Delete a deck and its questions.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "POST",
    path: "/decks/{id}/more",
    summary: "Generate more questions for a deck.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "POST",
    path: "/questions",
    summary: "Add a question by hand.",
    tag: "questions",
    auth: "user",
    body: schemas.ManualQuestionSchema,
  },
  {
    method: "PATCH",
    path: "/questions/{id}",
    summary: "Edit a question.",
    tag: "questions",
    auth: "user",
    body: schemas.UpdateQuestionSchema,
  },
  {
    method: "DELETE",
    path: "/questions/{id}",
    summary: "Delete a question.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "POST",
    path: "/questions/accept",
    summary: "Keep the generated questions you picked.",
    tag: "questions",
    auth: "user",
    body: schemas.AcceptQuestionsSchema,
  },
  {
    method: "POST",
    path: "/question-sources/topics",
    summary: "Start a deck from a few topics.",
    tag: "questions",
    auth: "user",
    body: schemas.TopicSourceSchema,
  },
  {
    method: "POST",
    path: "/question-sources/resume",
    summary: "Start a deck from resume text.",
    tag: "questions",
    auth: "user",
    body: schemas.ResumeTextSchema,
  },
  {
    method: "POST",
    path: "/question-sources/document",
    summary:
      "Start a deck from a document in any subject: a PDF, Word file or text (base64), or pasted text. purpose resume makes interview questions about your own experience.",
    tag: "questions",
    auth: "user",
    body: schemas.DocumentSourceSchema,
  },
  {
    method: "POST",
    path: "/question-sources/{id}/generate",
    summary: "Generate questions from a source.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "GET",
    path: "/question-sources/{id}/pending",
    summary: "Generated questions waiting for review.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "DELETE",
    path: "/question-sources/{id}/resume",
    summary: "Delete the stored resume text for a source.",
    tag: "questions",
    auth: "user",
  },
  {
    method: "GET",
    path: "/jobs/{id}",
    summary: "Whether a background job (summarising, generating) is done.",
    tag: "questions",
    auth: "user",
  },

  // ------------------------------------------------------------ public page (PRD 28)
  {
    method: "GET",
    path: "/public-page",
    summary: "Your public page settings, its address and how many links are on it.",
    tag: "public-page",
    auth: "user",
    response: schemas.PublicPageSettingsResponseSchema,
  },
  {
    method: "PATCH",
    path: "/public-page",
    summary: "Set up or change your public page. The first save needs a handle.",
    tag: "public-page",
    auth: "user",
    body: schemas.PublicProfilePatchSchema,
    response: schemas.PublicPageSettingsResponseSchema,
  },
  {
    method: "GET",
    path: "/public-page/handle-check",
    summary: "Whether a handle is free and allowed.",
    tag: "public-page",
    auth: "user",
    query: ["handle"],
    response: schemas.HandleCheckResponseSchema,
  },
  {
    method: "GET",
    path: "/public-page/resume-draft",
    summary: "A draft of the page's work side from your newest resume. Saves nothing.",
    tag: "public-page",
    auth: "user",
    response: schemas.ResumeDraftResponseSchema,
  },
  {
    method: "GET",
    path: "/public-page/days",
    summary: "Your profile's day feed as visitors see it, seven days at a time, with link ids.",
    tag: "public-page",
    auth: "user",
    query: ["before"],
    response: schemas.OwnerPageDaysResponseSchema,
  },
  {
    method: "GET",
    path: "/public-page/links",
    summary: "The links on your public page, newest first.",
    tag: "public-page",
    auth: "user",
    query: ["limit", "cursor"],
    response: schemas.SharedLinkListResponseSchema,
  },
  {
    method: "POST",
    path: "/links/{id}/share",
    summary: "Put a read link on your public page with a takeaway, or change its takeaway.",
    tag: "public-page",
    auth: "user",
    body: schemas.ShareLinkSchema,
  },
  {
    method: "DELETE",
    path: "/links/{id}/share",
    summary: "Take a link off your public page.",
    tag: "public-page",
    auth: "user",
  },
  {
    method: "GET",
    path: "/u/{handle}",
    summary: "Someone's public page. 404 when there is none or it is turned off.",
    tag: "public-page",
    auth: "none",
    query: ["cursor"],
    response: schemas.PublicPageResponseSchema,
  },
  {
    method: "GET",
    path: "/u/{handle}/days",
    summary:
      'Older days of someone\'s "What I learned" feed, seven at a time: pass the last day you have as before.',
    tag: "public-page",
    auth: "none",
    query: ["before"],
    response: schemas.PublicDaysResponseSchema,
  },
  {
    method: "GET",
    path: "/u/{handle}/avatar",
    summary: "The picture on someone's public page. 404 when there is none or the page is off.",
    tag: "public-page",
    auth: "none",
  },

  // ------------------------------------------------------------ agent highlights (PRD 29)
  {
    method: "POST",
    path: "/agent/sessions",
    summary:
      "Report one finished coding agent session: times, token counts, files changed and commit messages. Nothing else is accepted. Works with an agent token.",
    tag: "agent",
    auth: "user",
    body: schemas.AgentSignalSchema,
  },
  {
    method: "POST",
    path: "/agent/highlights",
    summary:
      "Pin a line in today's journal. It skips the digest and starts as kept. Works with an agent token.",
    tag: "agent",
    auth: "user",
    body: schemas.PinHighlightSchema,
  },
  {
    method: "GET",
    path: "/agent/stats",
    summary: "Daily agent totals (sessions, active and agent minutes, tokens) and days building.",
    tag: "agent",
    auth: "user",
    query: ["days"],
    response: schemas.AgentStatsResponseSchema,
  },
  {
    method: "POST",
    path: "/agent/tokens",
    summary:
      "Create a token for a coding agent's config. It can only report sessions and highlights.",
    tag: "agent",
    auth: "user",
    body: schemas.AgentTokenSchema,
    response: schemas.AgentTokenResponseSchema,
  },
  {
    method: "POST",
    path: "/agent/digest",
    summary: "Draft a day's highlights now, rather than waiting for the day to end.",
    tag: "agent",
    auth: "user",
    body: schemas.DraftHighlightsSchema,
  },
  {
    method: "GET",
    path: "/journal",
    summary:
      "Your journal: each day with what you read, how many cards you reviewed, your agent totals and highlights, newest first.",
    tag: "agent",
    auth: "user",
    query: ["days"],
  },
  {
    method: "GET",
    path: "/highlights",
    summary: "Your highlights, drafts included, newest day first.",
    tag: "agent",
    auth: "user",
    query: ["days"],
    response: schemas.HighlightListResponseSchema,
  },
  {
    method: "PATCH",
    path: "/highlights/{id}",
    summary: "Keep, drop or reword a highlight.",
    tag: "agent",
    auth: "user",
    body: schemas.HighlightPatchSchema,
  },
  {
    method: "POST",
    path: "/mcp",
    summary:
      "MCP server (streamable HTTP, JSON responses) with two tools: highlight and save_link. Works with an agent token.",
    tag: "agent",
    auth: "user",
  },
  {
    method: "GET",
    path: "/mcp",
    summary: "Not used: the MCP server answers POST only.",
    tag: "agent",
    auth: "user",
  },

  // ------------------------------------------------------------ profile
  {
    method: "GET",
    path: "/profile",
    summary: "Your name and where your picture is.",
    tag: "settings",
    auth: "user",
    response: schemas.ProfileResponseSchema,
  },
  {
    method: "PATCH",
    path: "/profile",
    summary:
      "Change your name, your picture, or both. The picture is a data URL of a JPEG, PNG or WebP; null removes it.",
    tag: "settings",
    auth: "user",
    body: schemas.ProfilePatchSchema,
    response: schemas.ProfileResponseSchema,
  },
  {
    method: "GET",
    path: "/profile/avatar",
    summary: "Your picture. 404 when you have none.",
    tag: "settings",
    auth: "user",
  },

  // ------------------------------------------------------------ settings
  {
    method: "GET",
    path: "/settings",
    summary: "Settings, which ones the environment locks, and the feature flags.",
    tag: "settings",
    auth: "user",
  },
  {
    method: "PATCH",
    path: "/settings",
    summary: "Change settings.",
    tag: "settings",
    auth: "user",
    body: schemas.SettingsPatchSchema,
  },
  {
    method: "POST",
    path: "/settings/pause",
    summary: "Pause reminders for a number of days.",
    tag: "settings",
    auth: "user",
    body: schemas.PauseSchema,
  },
  {
    method: "POST",
    path: "/settings/resume",
    summary: "Turn reminders back on.",
    tag: "settings",
    auth: "user",
  },
  {
    method: "GET",
    path: "/ai/providers",
    summary: "The AI providers set up, with keys masked.",
    tag: "settings",
    auth: "user",
  },
  {
    method: "POST",
    path: "/ai/providers",
    summary: "Save an AI provider.",
    tag: "settings",
    auth: "user",
    body: schemas.AiProviderSchema,
  },
  {
    method: "POST",
    path: "/ai/providers/test",
    summary: "Check an AI provider works before saving it.",
    tag: "settings",
    auth: "user",
    body: schemas.AiProviderSchema,
  },
  {
    method: "GET",
    path: "/stats",
    summary: "Reviews per day, cards due per day, AI usage and scores by tag.",
    tag: "settings",
    auth: "user",
  },
  {
    method: "GET",
    path: "/export",
    summary: "Everything you saved, as JSON. No secrets.",
    tag: "settings",
    auth: "user",
  },
  {
    method: "DELETE",
    path: "/account",
    summary:
      "Delete your account: every link, deck, question, review and upload, then the account itself where the server allows it. The app's own way to do this, so stores that require in-app account deletion are satisfied.",
    tag: "settings",
    auth: "user",
    body: schemas.DeleteAccountSchema,
  },
  {
    method: "DELETE",
    path: "/data",
    summary: "Delete all of your data.",
    tag: "settings",
    auth: "user",
  },

  // ------------------------------------------------------------ notifications
  {
    method: "POST",
    path: "/devices",
    summary: "Register a phone for push reminders. Call again whenever the push token changes.",
    tag: "notifications",
    auth: "user",
    body: schemas.RegisterDeviceSchema,
  },
  {
    method: "DELETE",
    path: "/devices",
    summary: "Stop push reminders to a phone.",
    tag: "notifications",
    auth: "user",
    body: schemas.UnregisterDeviceSchema,
  },
  {
    method: "POST",
    path: "/notifications/test",
    summary: "Send a test reminder on one channel.",
    tag: "notifications",
    auth: "user",
    body: schemas.TestChannelSchema,
  },
  {
    method: "GET",
    path: "/push/vapid-public-key",
    summary: "The web push key a browser subscribes with.",
    tag: "notifications",
    auth: "none",
    internal: true,
  },
  {
    method: "POST",
    path: "/push/subscribe",
    summary: "Subscribe a browser to web push.",
    tag: "notifications",
    auth: "user",
    body: schemas.PushSubscribeSchema,
    internal: true,
  },
  {
    method: "DELETE",
    path: "/push/subscribe",
    summary: "Unsubscribe a browser from web push.",
    tag: "notifications",
    auth: "user",
    body: schemas.UnsubscribePushSchema,
    internal: true,
  },
  {
    method: "POST",
    path: "/telegram/link-code",
    summary: "A code to send the Telegram bot to link your chat.",
    tag: "notifications",
    auth: "user",
  },
  {
    method: "POST",
    path: "/email/verify-request",
    summary: "Send a verification email.",
    tag: "notifications",
    auth: "user",
    body: schemas.EmailVerifyRequestSchema,
  },
  {
    method: "GET",
    path: "/email/verify",
    summary: "The link in the verification email.",
    tag: "notifications",
    auth: "special",
    internal: true,
  },
  {
    method: "GET",
    path: "/email/pause",
    summary: "The pause link in a reminder email.",
    tag: "notifications",
    auth: "special",
    internal: true,
  },
  {
    method: "GET",
    path: "/email/unsubscribe",
    summary: "The unsubscribe link in a reminder email.",
    tag: "notifications",
    auth: "special",
    internal: true,
  },
  {
    method: "POST",
    path: "/email/unsubscribe",
    summary: "One-click unsubscribe (RFC 8058), sent by mail clients.",
    tag: "notifications",
    auth: "special",
    internal: true,
  },
  {
    method: "POST",
    path: "/telegram/webhook",
    summary: "Updates from Telegram. Checked against the webhook secret.",
    tag: "notifications",
    auth: "special",
    internal: true,
  },

  // ------------------------------------------------------------ ops
  {
    method: "GET",
    path: "/health",
    summary: "Whether the app, the database and the worker are up.",
    tag: "ops",
    auth: "none",
  },
];
