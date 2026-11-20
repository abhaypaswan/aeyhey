// SPDX-License-Identifier: AGPL-3.0-only
// Shared domain enums and JSON column shapes (PRD 10).
//
// SQLite has no enum type and we want the same values on Postgres, so every enum here is
// a string union plus a frozen list. The list is what Zod and the schema files use.

export const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const MIX_MODES = ["auto", "explicit"] as const;
export type MixMode = (typeof MIX_MODES)[number];

export const AI_PROVIDER_KINDS = ["openai", "anthropic", "ollama", "mock"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_TASKS = ["summary", "generate", "grade", "profile"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const CREDENTIAL_SOURCES = ["env", "user", "managed"] as const;
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number];

export const CONTENT_TYPES = [
  "article",
  "thread",
  "video",
  "paper",
  "tool",
  "docs",
  "other",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const EXTRACT_STATUSES = ["pending", "ok", "partial", "failed"] as const;
export type ExtractStatus = (typeof EXTRACT_STATUSES)[number];

export const AI_STATUSES = ["pending", "ok", "failed", "skipped"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const LINK_STATUSES = [
  "unread",
  "snoozed",
  "read",
  "dropped",
  "expiring",
  "expired",
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const IMPORT_SOURCES = [
  "paste",
  "share",
  "bookmarklet",
  "telegram",
  "pocket",
  "bookmarks_html",
  "x_csv",
  "karakeep",
  "linkwarden",
  "agent",
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** "document" is any file or pasted text to study from: a book, notes, a paper. */
export const QUESTION_SOURCE_KINDS = ["topics", "resume", "document"] as const;
export type QuestionSourceKind = (typeof QUESTION_SOURCE_KINDS)[number];

export const DECK_KINDS = ["links", "topics", "resume", "manual", "document"] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

export const QUESTION_CATEGORIES = [
  "technical",
  "behavioral",
  "system_design",
  "project_deep_dive",
  "concept",
  "coding_concept",
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * The first three are for studying any subject, the last four for interview prep. Both
 * sets are stored as written and passed to the model as words, so either works anywhere.
 */
export const QUESTION_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "junior",
  "mid",
  "senior",
  "staff",
] as const;
export type QuestionLevel = (typeof QUESTION_LEVELS)[number];

export const QUESTION_STYLES = ["interview", "study", "mixed"] as const;
export type QuestionStyle = (typeof QUESTION_STYLES)[number];

export const QUESTION_FOCUSES = [
  "projects",
  "skills",
  "behavioral",
  "system_design",
  "coding_concepts",
] as const;
export type QuestionFocus = (typeof QUESTION_FOCUSES)[number];

export const REVIEW_STATUSES = ["pending_review", "kept", "removed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ITEM_TYPES = ["link", "question"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** cards.status. Questions use new/active/suspended/deleted; links mirror links.status. */
export const CARD_STATUSES = [
  "new",
  "active",
  "suspended",
  "deleted",
  "unread",
  "snoozed",
  "read",
  "dropped",
  "expiring",
  "expired",
] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const REVIEW_ACTIONS = [
  "answer",
  "reveal",
  "rate",
  "skip",
  "read",
  "snooze",
  "drop",
  "expire",
  "restore",
  "ignore",
  "undo",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const CHANNELS = ["web", "telegram", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const VERDICTS = ["correct", "partial", "incorrect"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const SESSION_STATUSES = ["open", "done", "expired"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_TRIGGERS = ["scheduled", "manual", "telegram"] as const;
export type SessionTrigger = (typeof SESSION_TRIGGERS)[number];

export const SESSION_ITEM_STATUSES = ["pending", "done", "skipped"] as const;
export type SessionItemStatus = (typeof SESSION_ITEM_STATUSES)[number];

export const NOTIFICATION_STATUSES = ["queued", "sent", "failed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const JOB_TYPES = [
  "extract_link",
  "enrich_link",
  "parse_resume",
  "build_profile",
  "generate_questions",
  "send_reminder",
  "import_file",
  "expire_links",
  "release_reservations",
  "top_up_questions",
  "digest_agent_day",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** "blocked" is a usage gate refusal, not an error. It resumes when the gate allows it. */
export const JOB_STATUSES = ["queued", "running", "done", "failed", "blocked"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const USER_ROLES = ["owner", "member", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ---------- JSON column shapes ----------

export interface QuietHours {
  /** "22:00" */
  start: string;
  /** "07:00" */
  end: string;
}

export interface ProviderModels {
  summary?: string;
  generate?: string;
  grade?: string;
  profile?: string;
}

export type SummaryLines = [string, string, string];

export interface ResumeSkill {
  name: string;
  category: "language" | "framework" | "database" | "cloud" | "tool" | "domain" | "soft";
}

export interface ResumeExperience {
  company: string;
  role: string;
  start?: string | null;
  end?: string | null;
  highlights: string[];
}

export interface ResumeProject {
  name: string;
  summary: string;
  tech: string[];
}

export interface ResumeProfile {
  headline: string;
  years_experience: number | null;
  skills: ResumeSkill[];
  experiences: ResumeExperience[];
  projects: ResumeProject[];
  likely_interview_areas: string[];
}

export interface GradeResult {
  score: number;
  verdict: Verdict;
  covered_points: string[];
  missed_points: string[];
  mistakes: string[];
  feedback: string;
  better_answer_tip?: string;
  suggested_rating: "again" | "hard" | "good" | "easy";
}

/** The FSRS fields we snapshot on every review log, for undo and for stats. */
export interface CardSnapshot {
  status: CardStatus;
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  fsrsState: number;
  lastReview: number | null;
  skipCount: number;
}

export interface SessionStats {
  cardsDone: number;
  linksRead: number;
  linksDropped: number;
  linksSnoozed: number;
  questionsAnswered: number;
  questionsSkipped: number;
  averageScore: number | null;
  linksExpired: number;
}

// ---------------------------------------------------------------- public page, work side (PRD 28.6c)

export interface PublicLink {
  /** What the visitor reads: "GitHub", "LinkedIn", "Website". */
  label: string;
  /** http or https only. */
  url: string;
}

export interface PublicExperience {
  role: string;
  company: string;
  /** Free text such as "Mar 2023" or "2021". */
  start?: string | null;
  /** Null or missing means "Present". */
  end?: string | null;
  summary?: string | null;
}

export interface PublicProject {
  name: string;
  description?: string | null;
  url?: string | null;
  tech?: string[];
}

// ---------------------------------------------------------------- agent sessions (PRD 29)

/** Tokens and messages for one model. */
export interface AgentModelUsage {
  input: number;
  output: number;
  cache: number;
  messages: number;
}

/**
 * What a coding agent session reported beyond times and tokens: counts and names only,
 * never content. Every field is optional, so older hooks and other tools still fit. The
 * day's row holds the same shape, added up across its sessions.
 */
export interface AgentSessionDetails {
  /** The agent's version, how it was opened (cli, claude-desktop, vscode) and the OS. */
  client?: { version?: string; entrypoint?: string; platform?: string };
  models?: Record<string, AgentModelUsage>;
  prompts?: number;
  turns?: number;
  toolCalls?: Record<string, number>;
  toolErrors?: number;
  apiErrors?: number;
  compactions?: number;
  /** Turns run by subagents rather than the main agent. */
  subagentTurns?: number;
  skills?: Record<string, number>;
  plugins?: Record<string, number>;
  mcpServers?: Record<string, number>;
  /** Permission modes seen, such as auto or plan, by how many prompts used them. */
  modes?: Record<string, number>;
  /** Effort levels asked for, by turns. */
  effort?: Record<string, number>;
  /** Server side tools, such as web searches, by requests. */
  serverTools?: Record<string, number>;
  /** Files changed, by extension: the languages worked in. Never paths. */
  languages?: Record<string, number>;
  linesAdded?: number;
  linesRemoved?: number;
  /** Time between events, leaving out gaps longer than five minutes. */
  busyMinutes?: number;
  thinkingSeconds?: number;
  apiSeconds?: number;
  toolSeconds?: number;
  /** The agent's own cost estimate. Kept for later features, never shown (PRD 29.3). */
  costUsd?: number;
  /** Why the session ended, as the agent said: clear, logout, prompt_input_exit, other. */
  endReason?: string;
  /** The session's short title. Only sent when the person opted in on their machine. */
  title?: string;
}
