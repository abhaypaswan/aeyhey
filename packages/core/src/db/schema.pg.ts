// SPDX-License-Identifier: AGPL-3.0-only
// Postgres schema (PRD 10). A table for table mirror of schema.sqlite.ts.
//
// Only the column types differ:
//   integer timestamp_ms  ->  timestamp with time zone
//   text json mode        ->  jsonb
//   real                  ->  double precision
//   integer boolean mode  ->  boolean
// Anything that changes here changes in schema.sqlite.ts too. The dialect-agnostic
// contract both files satisfy is checked by tests/unit/schema-parity.test.ts.

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  AgentSessionDetails,
  AiProviderKind,
  AiStatus,
  AiTask,
  Cadence,
  CardSnapshot,
  CardStatus,
  Channel,
  ContentType,
  CredentialSource,
  DeckKind,
  DevicePlatform,
  Difficulty,
  ExtractStatus,
  GradeResult,
  ImportSource,
  ItemType,
  JobStatus,
  JobType,
  LinkStatus,
  MixMode,
  NotificationStatus,
  ProviderModels,
  PublicExperience,
  PublicLink,
  PublicProject,
  QuestionCategory,
  QuestionFocus,
  QuestionLevel,
  QuestionSourceKind,
  QuestionStyle,
  QuietHours,
  ResumeProfile,
  ReviewAction,
  ReviewStatus,
  SessionItemStatus,
  SessionStats,
  SessionStatus,
  SessionTrigger,
  SummaryLines,
  UserRole,
  Verdict,
} from "./types";

const id = () => text("id").primaryKey();
const userId = () => text("user_id").notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const nowDefault = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------- users and settings

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull().default("You"),
    timezone: text("timezone").notNull().default("UTC"),
    role: text("role").$type<UserRole>().notNull().default("owner"),
    createdAt: nowDefault(),
  },
  (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }),
);

export const settings = pgTable("settings", {
  userId: text("user_id").primaryKey(),
  cadence: text("cadence").$type<Cadence>().notNull().default("daily"),
  cadenceWeekdays: jsonb("cadence_weekdays").$type<number[]>().notNull().default([1]),
  cadenceDayOfMonth: integer("cadence_day_of_month").notNull().default(1),
  sendTime: text("send_time").notNull().default("09:00"),
  quietHours: jsonb("quiet_hours").$type<QuietHours | null>(),
  cardsPerSession: integer("cards_per_session").notNull().default(5),
  mixMode: text("mix_mode").$type<MixMode>().notNull().default("auto"),
  mixLinks: integer("mix_links").notNull().default(2),
  mixQuestions: integer("mix_questions").notNull().default(3),
  maxNewQuestions: integer("max_new_questions").notNull().default(3),
  maxNewLinks: integer("max_new_links").notNull().default(2),
  requestRetention: doublePrecision("request_retention").notNull().default(0.9),
  expiryEnabled: boolean("expiry_enabled").notNull().default(true),
  expiryMaxSnoozes: integer("expiry_max_snoozes").notNull().default(5),
  expiryMaxIgnored: integer("expiry_max_ignored").notNull().default(3),
  expiryUnreadDays: integer("expiry_unread_days").notNull().default(180),
  stripPii: boolean("strip_pii").notNull().default(true),
  pausedUntil: ts("paused_until"),
  updatedAt: updatedAt(),
});

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: id(),
    userId: userId(),
    kind: text("kind").$type<AiProviderKind>().notNull(),
    baseUrl: text("base_url"),
    apiKeyEnc: text("api_key_enc"),
    models: jsonb("models").$type<ProviderModels>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: nowDefault(),
  },
  (t) => ({
    userIdx: index("ai_providers_user_idx").on(t.userId),
    userKindIdx: uniqueIndex("ai_providers_user_kind_idx").on(t.userId, t.kind),
  }),
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: userId(),
    task: text("task").$type<AiTask>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    credentialSource: text("credential_source").$type<CredentialSource>().notNull(),
    jobId: text("job_id"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    createdAt: nowDefault(),
  },
  (t) => ({
    userAtIdx: index("ai_usage_user_at_idx").on(t.userId, t.createdAt),
    userTaskIdx: index("ai_usage_user_task_idx").on(t.userId, t.task),
  }),
);

// ---------------------------------------------------------------- links

export const links = pgTable(
  "links",
  {
    id: id(),
    userId: userId(),
    url: text("url").notNull(),
    urlNormalized: text("url_normalized").notNull(),
    title: text("title"),
    siteName: text("site_name"),
    author: text("author"),
    publishedAt: ts("published_at"),
    imageUrl: text("image_url"),
    contentType: text("content_type").$type<ContentType>().notNull().default("other"),
    extractedText: text("extracted_text"),
    extractStatus: text("extract_status").$type<ExtractStatus>().notNull().default("pending"),
    aiStatus: text("ai_status").$type<AiStatus>().notNull().default("pending"),
    summaryLines: jsonb("summary_lines").$type<SummaryLines | null>(),
    whySaved: text("why_saved"),
    summaryConfidence: text("summary_confidence").$type<"high" | "low" | null>(),
    readMinutes: integer("read_minutes"),
    language: text("language"),
    userNote: text("user_note"),
    status: text("status").$type<LinkStatus>().notNull().default("unread"),
    snoozeCount: integer("snooze_count").notNull().default(0),
    ignoredCount: integer("ignored_count").notNull().default(0),
    rescued: boolean("rescued").notNull().default(false),
    savedAt: ts("saved_at").notNull().defaultNow(),
    importedAt: ts("imported_at"),
    importSource: text("import_source").$type<ImportSource>().notNull().default("paste"),
    readAt: ts("read_at"),
    /** Set when the user puts this link on their public page (PRD 28). Null when not shown. */
    sharedAt: ts("shared_at"),
    /** The takeaway as the user confirmed it, shown on the public page. Max 500 characters. */
    publicTakeaway: text("public_takeaway"),
    createdAt: nowDefault(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userUrlIdx: uniqueIndex("links_user_url_idx").on(t.userId, t.urlNormalized),
    userStatusIdx: index("links_user_status_idx").on(t.userId, t.status),
    userSavedIdx: index("links_user_saved_idx").on(t.userId, t.savedAt),
    pipelineIdx: index("links_pipeline_idx").on(t.extractStatus, t.aiStatus),
    userSharedIdx: index("links_user_shared_idx").on(t.userId, t.sharedAt),
  }),
);

// ---------------------------------------------------------------- agent highlights (PRD 29)

/**
 * One finished coding agent session, as its hook reported it. Private and short lived:
 * deleted a week after its day is digested. Holds numbers, names and commit messages
 * only, never code, prompts or transcripts (PRD 29.2).
 */
export const agentSignals = pgTable(
  "agent_signals",
  {
    id: id(),
    userId: userId(),
    /** The agent's own id for the session, so a resent signal updates rather than adds. */
    sessionId: text("session_id").notNull(),
    /** claude-code, codex, or another tool's short name. */
    tool: text("tool").notNull(),
    repo: text("repo"),
    branch: text("branch"),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    /** The day it counts for, YYYY-MM-DD in the user's timezone when it ended. */
    day: text("day").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheTokens: integer("cache_tokens").notNull().default(0),
    filesChanged: integer("files_changed").notNull().default(0),
    /** Commit messages made during the session, after the secret filter. */
    /** Counts and names only, such as models and tool calls (PRD 29.2). */
    details: jsonb("details").$type<AgentSessionDetails>().notNull().default({}),
    commits: jsonb("commits").$type<string[]>().notNull().default([]),
    digestedAt: ts("digested_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    sessionIdx: uniqueIndex("agent_signals_session_idx").on(t.userId, t.tool, t.sessionId),
    userDayIdx: index("agent_signals_user_day_idx").on(t.userId, t.day),
  }),
);

/** Daily totals, kept after the signals they were counted from are gone (PRD 29.3). */
export const agentDays = pgTable(
  "agent_days",
  {
    userId: userId(),
    day: text("day").notNull(),
    sessions: integer("sessions").notNull().default(0),
    /** The union of session time, so parallel sessions are not counted twice. */
    activeMinutes: integer("active_minutes").notNull().default(0),
    /** The plain sum of session time. */
    agentMinutes: integer("agent_minutes").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheTokens: integer("cache_tokens").notNull().default(0),
    /** Per tool: sessions and tokens. */
    /** The day's details, added up across its sessions. */
    details: jsonb("details").$type<AgentSessionDetails>().notNull().default({}),
    tools: jsonb("tools")
      .$type<Record<string, { sessions: number; tokens: number }>>()
      .notNull()
      .default({}),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.day] }) }),
);

/** A line in the daily journal: drafted by the digest, or pinned by the person. */
export const agentHighlights = pgTable(
  "agent_highlights",
  {
    id: id(),
    userId: userId(),
    day: text("day").notNull(),
    text: text("text").notNull(),
    /** shipped, progress, learned or pinned. */
    kind: text("kind").notNull(),
    /** draft until the person keeps or drops it. Pinned lines start as kept. */
    status: text("status").notNull().default("draft"),
    repo: text("repo"),
    /** Kept, but not for the public page, such as an employer's work. */
    hiddenFromPage: boolean("hidden_from_page").notNull().default(false),
    createdAt: nowDefault(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({ userDayIdx: index("agent_highlights_user_day_idx").on(t.userId, t.day) }),
);

// ---------------------------------------------------------------- profile picture

/**
 * The picture a person chose for themselves, one row per user. Kept apart from users so
 * the few kilobytes of image are not read with every request that loads the user. The
 * client sends it already cropped and shrunk; the server checks the bytes are an image.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: text("user_id").primaryKey(),
  /** image/jpeg, image/png or image/webp, read from the bytes, never from the client. */
  mime: text("mime").notNull(),
  /** Base64, so both dialects store it the same way. */
  data: text("data").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ---------------------------------------------------------------- public page (PRD 28)

/**
 * One row per user who has set up a public "What I learned" page. The handle is unique
 * across the whole instance, not per user: it is the address of the page, so two users
 * cannot share one. That makes it the one unique index here without user_id in it, on
 * purpose (PRD 23.7 covers per-user data; a handle is a shared namespace).
 */
export const publicProfiles = pgTable(
  "public_profiles",
  {
    userId: text("user_id").primaryKey(),
    handle: text("handle").notNull(),
    title: text("title"),
    bio: text("bio"),
    enabled: boolean("enabled").notNull().default(false),
    indexable: boolean("indexable").notNull().default(false),
    showFooter: boolean("show_footer").notNull().default(true),
    /** Days active, streaks, reading totals, topics and the activity grid (PRD 28). */
    showStats: boolean("show_stats").notNull().default(true),
    /**
     * What visitors see of work done with coding agents (PRD 29.3): off, numbers, or
     * numbers and kept highlights. Off by default: nothing about it shows, not even in
     * the streak or the activity grid.
     */
    buildingVisibility: text("building_visibility").notNull().default("off"),
    /** Show which models and how many tokens. A separate switch, off by default. */
    showAgentModels: boolean("show_agent_models").notNull().default(false),
    /** The work side of the page (PRD 28.6c): a one-pager for job applications. */
    headline: text("headline"),
    location: text("location"),
    links: jsonb("links").$type<PublicLink[]>().notNull().default([]),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    interests: jsonb("interests").$type<string[]>().notNull().default([]),
    experience: jsonb("experience").$type<PublicExperience[]>().notNull().default([]),
    projects: jsonb("projects").$type<PublicProject[]>().notNull().default([]),
    /** The handle before the last change. Its address redirects here for 30 days (FR-PUB-7). */
    previousHandle: text("previous_handle"),
    handleChangedAt: ts("handle_changed_at"),
    createdAt: nowDefault(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    handleIdx: uniqueIndex("public_profiles_handle_idx").on(t.handle),
    previousHandleIdx: index("public_profiles_previous_handle_idx").on(t.previousHandle),
  }),
);

// ---------------------------------------------------------------- questions

export const questionSources = pgTable(
  "question_sources",
  {
    id: id(),
    userId: userId(),
    kind: text("kind").$type<QuestionSourceKind>().notNull(),
    topics: jsonb("topics").$type<string[] | null>(),
    /**
     * What the user wrote about each topic, keyed by topic name, so every later batch for
     * that topic is accurate. A topic with nothing written is simply absent.
     */
    topicDetails: jsonb("topic_details")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    level: text("level").$type<QuestionLevel | null>(),
    style: text("style").$type<QuestionStyle | null>(),
    focus: jsonb("focus").$type<QuestionFocus[] | null>(),
    extraContext: text("extra_context"),
    resumeText: text("resume_text"),
    resumeFilePath: text("resume_file_path"),
    resumeProfile: jsonb("resume_profile").$type<ResumeProfile | null>(),
    targetRole: text("target_role"),
    seniority: text("seniority"),
    jobDescription: text("job_description"),
    /**
     * What the source covers and for whom, such as "Class 11 mathematics (CBSE)". Questions
     * stay inside it. Read from a document; null for typed topics and resumes.
     */
    scope: text("scope"),
    countPerTopic: integer("count_per_topic").notNull().default(5),
    createdAt: nowDefault(),
  },
  (t) => ({ userIdx: index("question_sources_user_idx").on(t.userId) }),
);

export const decks = pgTable(
  "decks",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    kind: text("kind").$type<DeckKind>().notNull(),
    sourceId: text("source_id"),
    /** Set while the user has paused the deck: its questions stay but are not asked. */
    pausedAt: ts("paused_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    userIdx: index("decks_user_idx").on(t.userId),
    userKindIdx: index("decks_user_kind_idx").on(t.userId, t.kind),
  }),
);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    userId: userId(),
    deckId: text("deck_id").notNull(),
    position: integer("position").notNull().default(0),
    text: text("text").notNull(),
    modelAnswer: text("model_answer").notNull(),
    keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
    category: text("category").$type<QuestionCategory>().notNull().default("technical"),
    difficulty: text("difficulty").$type<Difficulty>().notNull().default("medium"),
    resumeAnchor: text("resume_anchor"),
    origin: text("origin").$type<"ai" | "manual">().notNull().default("ai"),
    reviewStatus: text("review_status").$type<ReviewStatus>().notNull().default("pending_review"),
    createdAt: nowDefault(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userDeckIdx: index("questions_user_deck_idx").on(t.userId, t.deckId),
    userReviewIdx: index("questions_user_review_idx").on(t.userId, t.reviewStatus),
  }),
);

// ---------------------------------------------------------------- tags

export const tags = pgTable(
  "tags",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: nowDefault(),
  },
  (t) => ({ userNameIdx: uniqueIndex("tags_user_name_idx").on(t.userId, t.name) }),
);

export const itemTags = pgTable(
  "item_tags",
  {
    userId: userId(),
    itemType: text("item_type").$type<ItemType>().notNull(),
    itemId: text("item_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemType, t.itemId, t.tagId] }),
    tagIdx: index("item_tags_tag_idx").on(t.userId, t.tagId),
    itemIdx: index("item_tags_item_idx").on(t.itemType, t.itemId),
  }),
);

// ---------------------------------------------------------------- cards and reviews

export const cards = pgTable(
  "cards",
  {
    id: id(),
    userId: userId(),
    itemType: text("item_type").$type<ItemType>().notNull(),
    itemId: text("item_id").notNull(),
    status: text("status").$type<CardStatus>().notNull().default("new"),
    due: ts("due").notNull().defaultNow(),
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    learningSteps: integer("learning_steps").notNull().default(0),
    fsrsState: integer("fsrs_state").notNull().default(0),
    lastReview: ts("last_review"),
    skipCount: integer("skip_count").notNull().default(0),
    createdAt: nowDefault(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    itemIdx: uniqueIndex("cards_item_idx").on(t.itemType, t.itemId),
    dueIdx: index("cards_user_status_due_idx").on(t.userId, t.status, t.due),
    userTypeIdx: index("cards_user_type_idx").on(t.userId, t.itemType),
  }),
);

export const grades = pgTable(
  "grades",
  {
    id: id(),
    userId: userId(),
    questionId: text("question_id").notNull(),
    userAnswer: text("user_answer").notNull(),
    score: integer("score").notNull(),
    verdict: text("verdict").$type<Verdict>().notNull(),
    result: jsonb("result").$type<GradeResult>().notNull(),
    model: text("model").notNull().default(""),
    createdAt: nowDefault(),
  },
  (t) => ({ userQuestionIdx: index("grades_user_question_idx").on(t.userId, t.questionId) }),
);

export const reviewLogs = pgTable(
  "review_logs",
  {
    id: id(),
    userId: userId(),
    cardId: text("card_id").notNull(),
    sessionId: text("session_id"),
    action: text("action").$type<ReviewAction>().notNull(),
    rating: integer("rating"),
    suggestedRating: integer("suggested_rating"),
    gradeId: text("grade_id"),
    channel: text("channel").$type<Channel>().notNull().default("web"),
    cardBefore: jsonb("card_before").$type<CardSnapshot>().notNull(),
    cardAfter: jsonb("card_after").$type<CardSnapshot>().notNull(),
    fsrsLog: jsonb("fsrs_log").$type<Record<string, unknown> | null>(),
    durationMs: integer("duration_ms"),
    undone: boolean("undone").notNull().default(false),
    createdAt: nowDefault(),
  },
  (t) => ({
    cardAtIdx: index("review_logs_card_at_idx").on(t.cardId, t.createdAt),
    userAtIdx: index("review_logs_user_at_idx").on(t.userId, t.createdAt),
    sessionIdx: index("review_logs_session_idx").on(t.sessionId),
  }),
);

// ---------------------------------------------------------------- sessions

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: userId(),
    status: text("status").$type<SessionStatus>().notNull().default("open"),
    trigger: text("trigger").$type<SessionTrigger>().notNull().default("manual"),
    validUntil: ts("valid_until").notNull(),
    stats: jsonb("stats").$type<SessionStats | null>(),
    createdAt: nowDefault(),
    completedAt: ts("completed_at"),
  },
  (t) => ({
    userStatusIdx: index("sessions_user_status_idx").on(t.userId, t.status),
    userCreatedIdx: index("sessions_user_created_idx").on(t.userId, t.createdAt),
  }),
);

export const sessionItems = pgTable(
  "session_items",
  {
    userId: userId(),
    sessionId: text("session_id").notNull(),
    cardId: text("card_id").notNull(),
    position: integer("position").notNull(),
    status: text("status").$type<SessionItemStatus>().notNull().default("pending"),
    displayedAt: ts("displayed_at"),
    doneAt: ts("done_at"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.cardId] }),
    sessionPosIdx: index("session_items_session_pos_idx").on(t.sessionId, t.position),
  }),
);

// ---------------------------------------------------------------- notifications

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: userId(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    failCount: integer("fail_count").notNull().default(0),
    lastOkAt: ts("last_ok_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    userIdx: index("push_subscriptions_user_idx").on(t.userId),
  }),
);

export const telegramLinks = pgTable(
  "telegram_links",
  {
    userId: text("user_id").primaryKey(),
    chatId: text("chat_id"),
    username: text("username"),
    linkedAt: ts("linked_at"),
    linkCode: text("link_code"),
    linkCodeExpiresAt: ts("link_code_expires_at"),
  },
  (t) => ({
    chatIdx: uniqueIndex("telegram_links_chat_idx").on(t.chatId),
    codeIdx: index("telegram_links_code_idx").on(t.linkCode),
  }),
);

export const telegramMessages = pgTable(
  "telegram_messages",
  {
    id: id(),
    userId: userId(),
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    cardId: text("card_id"),
    sessionId: text("session_id"),
    createdAt: nowDefault(),
  },
  (t) => ({
    chatMessageIdx: uniqueIndex("telegram_messages_chat_message_idx").on(t.chatId, t.messageId),
    cardIdx: index("telegram_messages_card_idx").on(t.cardId),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userId(),
    channel: text("channel").$type<Channel>().notNull(),
    slotTime: ts("slot_time").notNull(),
    sessionId: text("session_id"),
    status: text("status").$type<NotificationStatus>().notNull().default("queued"),
    error: text("error"),
    sentAt: ts("sent_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    slotIdx: uniqueIndex("notifications_slot_idx").on(t.userId, t.channel, t.slotTime),
    statusIdx: index("notifications_status_idx").on(t.status),
  }),
);

// ---------------------------------------------------------------- app sign-in and devices

/**
 * Long-lived bearer tokens for apps that are not a browser, such as the mobile app.
 * One row per signed-in device. Only the SHA-256 of the token is stored, so a database
 * dump cannot be replayed, and revoking a row signs that device out.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    userId: userId(),
    /** What the person sees in Settings, such as "Pixel 8". */
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /**
     * app: everything the person can do. agent: only reporting agent sessions and
     * highlights (PRD 29.4 FR-AG-1), for tokens that live in a coding agent's config.
     */
    scope: text("scope").notNull().default("app"),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("api_tokens_token_hash_idx").on(t.tokenHash),
    userIdx: index("api_tokens_user_idx").on(t.userId),
  }),
);

/**
 * One-time codes from the /connect page. An app trades one, plus its PKCE verifier, for
 * an api token. They live for minutes and are single use.
 */
export const authCodes = pgTable(
  "auth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: userId(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    deviceName: text("device_name").notNull(),
    /** What the token it trades for may do: "app" for a phone, "agent" for a coding agent. */
    scope: text("scope").notNull().default("app"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: nowDefault(),
  },
  (t) => ({
    userIdx: index("auth_codes_user_idx").on(t.userId),
  }),
);

/**
 * Phones registered for native push. The token is whatever the platform push service
 * gave the app. Sending is done by a plugin's NativePushSender; core only stores these.
 */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: userId(),
    platform: text("platform").$type<DevicePlatform>().notNull(),
    pushToken: text("push_token").notNull(),
    /** The api token the device signed in with, so revoking it removes the device too. */
    apiTokenId: text("api_token_id"),
    appVersion: text("app_version"),
    failCount: integer("fail_count").notNull().default(0),
    lastOkAt: ts("last_ok_at"),
    createdAt: nowDefault(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => ({
    pushTokenIdx: uniqueIndex("devices_push_token_idx").on(t.pushToken),
    userIdx: index("devices_user_idx").on(t.userId),
  }),
);

// ---------------------------------------------------------------- jobs and ops

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    userId: text("user_id"),
    type: text("type").$type<JobType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total"),
    createdAt: nowDefault(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    pickupIdx: index("jobs_pickup_idx").on(t.status, t.runAfter),
    userIdx: index("jobs_user_idx").on(t.userId, t.type),
  }),
);

export const workerHeartbeat = pgTable("worker_heartbeat", {
  id: text("id").primaryKey().default("worker"),
  beatAt: ts("beat_at").notNull(),
  version: text("version").notNull().default("0.0.0"),
  hostname: text("hostname"),
});

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- relations

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(settings, { fields: [users.id], references: [settings.userId] }),
  links: many(links),
  decks: many(decks),
  cards: many(cards),
}));

export const linksRelations = relations(links, ({ one }) => ({
  user: one(users, { fields: [links.userId], references: [users.id] }),
}));

export const decksRelations = relations(decks, ({ one, many }) => ({
  user: one(users, { fields: [decks.userId], references: [users.id] }),
  source: one(questionSources, { fields: [decks.sourceId], references: [questionSources.id] }),
  questions: many(questions),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  deck: one(decks, { fields: [questions.deckId], references: [decks.id] }),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  reviewLogs: many(reviewLogs),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  card: one(cards, { fields: [reviewLogs.cardId], references: [cards.id] }),
  grade: one(grades, { fields: [reviewLogs.gradeId], references: [grades.id] }),
  session: one(sessions, { fields: [reviewLogs.sessionId], references: [sessions.id] }),
}));

export const sessionsRelations = relations(sessions, ({ many }) => ({
  items: many(sessionItems),
}));

export const sessionItemsRelations = relations(sessionItems, ({ one }) => ({
  session: one(sessions, { fields: [sessionItems.sessionId], references: [sessions.id] }),
  card: one(cards, { fields: [sessionItems.cardId], references: [cards.id] }),
}));
