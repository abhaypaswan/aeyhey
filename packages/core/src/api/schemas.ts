// SPDX-License-Identifier: AGPL-3.0-only
// Request schemas (PRD 11). Everything that crosses the boundary is validated here.

import { z } from "zod";
import {
  AI_STATUSES,
  CADENCES,
  CONTENT_TYPES,
  DECK_KINDS,
  DEVICE_PLATFORMS,
  EXTRACT_STATUSES,
  DIFFICULTIES,
  LINK_STATUSES,
  MIX_MODES,
  QUESTION_FOCUSES,
  QUESTION_LEVELS,
  QUESTION_STYLES,
} from "../db/types";

/**
 * An IANA timezone the runtime actually knows. Everything that schedules a reminder
 * formats a date in this zone, and a name with a typo in it throws there, a long way
 * from the form that let it in. So it is refused here.
 */
const timezoneSchema = z
  .string()
  .min(1)
  .max(60)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "That is not a timezone Aeyhey knows. Pick one from the list." },
  );

export const SetupSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  displayName: z.string().min(1).max(80).optional(),
  timezone: timezoneSchema.optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(1).max(200),
});

export const AddLinksSchema = z.object({
  text: z.string().min(1, "Paste at least one link.").max(2_000_000),
  note: z.string().max(500).optional(),
  source: z.enum(["paste", "share", "bookmarklet", "telegram"]).optional(),
});

export const UpdateLinkSchema = z.object({
  title: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  status: z.enum(LINK_STATUSES).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

export const BulkLinkSchema = z.object({
  ids: z.array(z.string()).min(1).max(1000),
  action: z.enum(["drop", "restore", "mark_read", "add_tag", "remove_tag"]),
  tag: z.string().max(40).optional(),
});

export const TopicSourceSchema = z.object({
  topics: z.array(z.string().min(1).max(80)).min(1, "Add at least one topic.").max(10),
  level: z.enum(QUESTION_LEVELS).default("mid"),
  style: z.enum(QUESTION_STYLES).default("interview"),
  countPerTopic: z.number().int().min(1).max(20).default(5),
  extraContext: z.string().max(1000).optional(),
});

export const ResumeTextSchema = z.object({
  text: z.string().min(50, "That is too short to be a resume.").max(100_000),
  targetRole: z.string().max(120).optional(),
  seniority: z.string().max(40).optional(),
  jobDescription: z.string().max(20_000).optional(),
  focus: z.array(z.enum(QUESTION_FOCUSES)).max(5).optional(),
  keepFile: z.boolean().default(false),
});

export const AcceptQuestionsSchema = z.object({
  keepIds: z.array(z.string()).max(500),
  removeIds: z.array(z.string()).max(500).optional(),
  edits: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1).max(400).optional(),
        modelAnswer: z.string().min(1).max(5000).optional(),
        tags: z.array(z.string().max(40)).max(6).optional(),
      }),
    )
    .max(500)
    .optional(),
});

export const GenerateMoreSchema = z.object({
  count: z.number().int().min(1).max(20).default(5),
});

export const ManualQuestionSchema = z.object({
  deckId: z.string(),
  text: z.string().min(1).max(400),
  modelAnswer: z.string().min(1).max(5000),
  keyPoints: z.array(z.string().max(200)).max(6).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  tags: z.array(z.string().max(40)).max(6).optional(),
});

export const RenameDeckSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the deck a name.")
      .max(120, "Keep the name to 120 characters.")
      .optional(),
    /**
     * Details per topic, by topic name, used in every later batch for that topic. Only
     * the topics given change; an empty string clears one.
     */
    topicDetails: z
      .record(
        z.string().min(1).max(200),
        z.string().trim().max(500, "Keep the details to 500 characters."),
      )
      .optional(),
    paused: z
      .boolean()
      .optional()
      .describe("True pauses the deck: its questions are kept but not asked. False resumes it."),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.topicDetails !== undefined || body.paused !== undefined,
    {
      message: "Send a new name, topic details, or whether the deck is paused.",
      path: ["name"],
    },
  );

export const UpdateQuestionSchema = z.object({
  text: z.string().min(1).max(400).optional(),
  modelAnswer: z.string().min(1).max(5000).optional(),
  keyPoints: z.array(z.string().max(200)).max(6).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

export const StartSessionSchema = z.object({
  size: z.number().int().min(1).max(30).optional(),
});

export const AnswerSchema = z.object({
  answer: z.string().min(1).max(4000),
});

export const SettingsPatchSchema = z.object({
  cadence: z.enum(CADENCES).optional(),
  cadenceWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  cadenceDayOfMonth: z
    .union([z.literal(-1), z.number().int().min(1).max(28)])
    .optional()
    .describe("1 to 28, or -1 for the last day of each month."),
  sendTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.")
    .optional(),
  quietHours: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable()
    .optional(),
  cardsPerSession: z.number().int().min(1).max(30).optional(),
  mixMode: z.enum(MIX_MODES).optional(),
  mixLinks: z.number().int().min(0).max(30).optional(),
  mixQuestions: z.number().int().min(0).max(30).optional(),
  maxNewQuestions: z.number().int().min(0).max(30).optional(),
  maxNewLinks: z.number().int().min(0).max(30).optional(),
  requestRetention: z.number().min(0.8).max(0.95).optional(),
  expiryEnabled: z.boolean().optional(),
  expiryMaxSnoozes: z.number().int().min(1).max(50).optional(),
  expiryMaxIgnored: z.number().int().min(1).max(50).optional(),
  expiryUnreadDays: z.number().int().min(7).max(3650).optional(),
  stripPii: z.boolean().optional(),
  timezone: timezoneSchema.optional(),
});

export const AiProviderSchema = z.object({
  kind: z.enum(["openai", "anthropic", "ollama", "mock"]),
  baseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  models: z
    .object({
      summary: z.string().max(120).optional(),
      generate: z.string().max(120).optional(),
      grade: z.string().max(120).optional(),
    })
    .optional(),
  isDefault: z.boolean().default(true),
});

export const PushSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
  userAgent: z.string().max(300).optional(),
});

export const EmailVerifyRequestSchema = z.object({
  address: z.string().email("That does not look like an email address."),
});

export const TestChannelSchema = z.object({
  channel: z.enum(["push", "telegram", "email"]),
});

/** A typed confirmation, so a stray request cannot remove an account. */
export const DeleteAccountSchema = z.object({
  confirm: z
    .literal("delete my account")
    .describe('Must be exactly "delete my account". This cannot be undone.'),
});

export const PauseSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  indefinite: z
    .boolean()
    .optional()
    .describe("Pause until reminders are turned back on. days is ignored when true."),
});

// ---------------------------------------------------------------- app sign-in and devices

/** RFC 7636: 43 to 128 characters from the unreserved set. */
const pkceString = z
  .string()
  .regex(/^[A-Za-z0-9\-._~]{43,128}$/, "That is not a valid PKCE value.");

export const ConnectApproveSchema = z.object({
  redirectUri: z.string().min(1).max(500),
  codeChallenge: pkceString,
  codeChallengeMethod: z.literal("S256"),
  deviceName: z.string().trim().min(1).max(80),
  /** Echoed back untouched, so the app can match the answer to its request. */
  state: z.string().max(500).optional(),
});

export const TokenExchangeSchema = z.object({
  grantType: z.literal("authorization_code"),
  code: z.string().min(1).max(200),
  codeVerifier: pkceString,
  redirectUri: z.string().min(1).max(500),
});

export const RegisterDeviceSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  pushToken: z.string().min(1).max(4096),
  appVersion: z.string().max(40).optional(),
});

export const UnregisterDeviceSchema = z.object({
  pushToken: z.string().min(1).max(4096),
});

export const UnsubscribePushSchema = z.object({ endpoint: z.string().url() });

// ---------------------------------------------------------------- documents

/** About 10 MB of file, as base64. */
const MAX_FILE_BASE64 = 14_000_000;

/**
 * A deck from a document: a book, notes, a paper, or a resume. Either a file (PDF, Word or
 * plain text, sent as base64 so the API stays JSON) or pasted text.
 *
 * purpose "study" writes questions that check understanding of the material, in any
 * subject. purpose "resume" takes the existing resume path: interview questions about the
 * person's own experience, with emails and phone numbers stripped first.
 */
export const DocumentSourceSchema = z
  .object({
    /**
     * auto reads the document and decides; study, resume and topics say it outright.
     * The default stays study so older clients behave as before.
     */
    purpose: z.enum(["auto", "study", "resume", "topics"]).default("study"),
    /** What the person typed next to the file, in their own words. */
    instruction: z.string().trim().max(1000).optional(),
    /** topics only. */
    countPerTopic: z.number().int().min(1).max(20).optional(),
    title: z.string().trim().max(120).optional(),
    text: z.string().max(500_000).optional(),
    file: z
      .object({
        name: z.string().max(200),
        contentType: z.string().max(120).optional(),
        base64: z.string().min(1).max(MAX_FILE_BASE64, "That file is too big. The limit is 10 MB."),
      })
      .optional(),
    level: z.enum(QUESTION_LEVELS).optional(),
    style: z.enum(QUESTION_STYLES).optional(),
    extraContext: z.string().max(1000).optional(),
    /** resume only. */
    targetRole: z.string().max(120).optional(),
    jobDescription: z.string().max(20_000).optional(),
  })
  .refine((body) => Boolean(body.file) !== Boolean(body.text?.trim()), {
    message: "Send a file or some text, not both.",
    path: ["file"],
  });

/** One message to the assistant (POST /api/assistant). */
export const AssistantSchema = z.object({
  message: z.string().trim().min(1, "Write or paste something first.").max(20_000),
  /** Set by a button that already says what was meant. */
  force: z.enum(["save_links", "make_deck", "ask"]).optional(),
  /** The last few turns, so a follow-up has context. */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2_000) }))
    .max(10)
    .optional(),
});

// ------------------------------------------------------------ responses
// Only a few responses have a schema so far. They feed docs/api/openapi.json and are not
// used to validate anything; the TypeScript types in the repos are the source of truth.

const dateTime = z.string().describe("An ISO 8601 date and time, in UTC.");

export const LifeLeftSchema = z
  .number()
  .min(0)
  .max(1)
  .nullable()
  .describe(
    "How much of its life the link has left before it goes to Last chance, from 1 (just " +
      "saved) to 0 (expired). It is the closest of the three expiry rules in the user's " +
      "settings: times snoozed, sessions ignored, and days unread. A link on its Last " +
      "chance reports 0.05. Null when the link does not expire: it is read or dropped, " +
      "or the user has turned expiry off.",
  );

export const LinkListItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  siteName: z.string().nullable(),
  contentType: z.enum(CONTENT_TYPES),
  status: z.enum(LINK_STATUSES),
  summaryLines: z.tuple([z.string(), z.string(), z.string()]).nullable(),
  whySaved: z.string().nullable(),
  readMinutes: z.number().nullable(),
  savedAt: dateTime,
  aiStatus: z.enum(AI_STATUSES),
  extractStatus: z.enum(EXTRACT_STATUSES),
  tags: z.array(z.string()),
  due: dateTime.nullable(),
  lifeLeft: LifeLeftSchema,
});

export const LinkListResponseSchema = z.object({
  items: z.array(LinkListItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .describe("Pass back as `cursor` for the next page. Null when there is no more."),
});

export const LinkResponseSchema = z.object({
  // The whole stored link is sent; only the fields clients rely on are listed here.
  link: z.looseObject({
    id: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    status: z.enum(LINK_STATUSES),
    savedAt: dateTime,
    importedAt: dateTime.nullable(),
    snoozeCount: z.number(),
    ignoredCount: z.number(),
    lifeLeft: LifeLeftSchema,
  }),
});

export const DeckWithCountsSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(DECK_KINDS),
  sourceId: z.string().nullable(),
  pausedAt: dateTime.nullable().describe("When the deck was paused, or null while it is asked."),
  createdAt: dateTime,
  counts: z.object({
    total: z.number(),
    new: z.number(),
    due: z.number(),
    dueNew: z.number().describe("Due and never asked yet."),
    dueReview: z.number().describe("Due again after being answered before."),
    learned: z.number().describe("Questions the scheduler now spaces 21 days or more apart."),
    suspended: z.number(),
  }),
});

export const DeckTopicSchema = z.object({
  name: z.string(),
  details: z
    .string()
    .nullable()
    .describe("What the user wrote about this topic, used whenever its questions are written."),
});

const deckTopicsField = z
  .array(DeckTopicSchema)
  .describe("The topics the deck is written from. Empty for resume, document and manual decks.");

export const DeckResponseSchema = z.object({
  deck: DeckWithCountsSchema,
  topics: deckTopicsField,
});

export const DeckDetailResponseSchema = z.object({
  // The stored deck and its kept questions; only the fields clients rely on are listed.
  deck: z.looseObject({
    id: z.string(),
    name: z.string(),
    kind: z.enum(DECK_KINDS),
    sourceId: z.string().nullable(),
    createdAt: dateTime,
  }),
  questions: z.array(
    z.looseObject({
      id: z.string(),
      text: z.string(),
      modelAnswer: z.string(),
      keyPoints: z.array(z.string()),
      difficulty: z.enum(DIFFICULTIES),
      tags: z.array(z.string()),
      progress: z
        .object({
          state: z
            .enum(["new", "due", "learning", "learned"])
            .describe(
              "new: never asked. due: asked before and come round again. learning: next review under 21 days away. learned: spaced 21 days or more apart.",
            ),
          timesAsked: z.number().describe("How many times it has been asked and answered."),
          lastAskedAt: dateTime.nullable().describe("When it was last asked, null if never."),
        })
        .nullable()
        .describe(
          "Where the question stands in spaced repetition. Null when it is suspended. When it is next asked is left out on purpose.",
        ),
      lastAnswer: z
        .object({
          text: z.string().describe("What the user wrote."),
          verdict: z.enum(["correct", "partial", "incorrect"]),
          score: z.number().describe("0 to 100, as graded."),
          answeredAt: dateTime,
        })
        .nullable()
        .describe(
          "The user's latest written answer, from a review that still stands. Null when never answered in writing.",
        ),
    }),
  ),
  topics: deckTopicsField,
  nextQuestionsLabel: z
    .string()
    .nullable()
    .describe(
      'When Aeyhey writes this deck\'s next questions, such as "Tomorrow at 09:00": just before the next reminder. Null when reminders are paused or the deck is not written by Aeyhey. New questions are only written once every question in the deck has been asked at least once.',
    ),
});

// ------------------------------------------------------------ public page (PRD 28)

// The work side of the page (PRD 28.6c). Links are http or https only: anything else could
// run script on a visitor's page.
const webUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (value) => /^https?:\/\/[^\s]+$/i.test(value),
    "Use a full web address, starting with https://.",
  );

export const PublicLinkSchema = z.object({
  label: z.string().trim().min(1).max(30),
  url: webUrl,
});

export const PublicExperienceSchema = z.object({
  role: z.string().trim().min(1, "Add the role.").max(80),
  company: z.string().trim().min(1, "Add the company.").max(80),
  start: z.string().trim().max(20).nullable().optional(),
  end: z.string().trim().max(20).nullable().optional(),
  summary: z.string().trim().max(400).nullable().optional(),
});

export const PublicProjectSchema = z.object({
  name: z.string().trim().min(1, "Add the project name.").max(80),
  description: z.string().trim().max(300).nullable().optional(),
  url: webUrl.nullable().optional(),
  tech: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
});

export const PublicProfilePatchSchema = z.object({
  handle: z.string().max(40).optional(),
  title: z.string().max(80).nullable().optional(),
  bio: z.string().max(160).nullable().optional(),
  enabled: z.boolean().optional(),
  indexable: z.boolean().optional(),
  showFooter: z.boolean().optional(),
  showStats: z.boolean().optional(),
  buildingVisibility: z
    .enum(["off", "numbers", "highlights"])
    .optional()
    .describe("What visitors see of work with coding agents. Off shows nothing at all."),
  showAgentModels: z.boolean().optional(),
  headline: z.string().max(120).nullable().optional(),
  location: z.string().max(80).nullable().optional(),
  links: z.array(PublicLinkSchema).max(6).optional(),
  skills: z.array(z.string().max(40)).max(20).optional(),
  interests: z.array(z.string().max(40)).max(12).optional(),
  experience: z.array(PublicExperienceSchema).max(10).optional(),
  projects: z.array(PublicProjectSchema).max(8).optional(),
});

export const ShareLinkSchema = z.object({
  takeaway: z
    .string()
    .trim()
    .min(1, "Write the takeaway first.")
    .max(500, "Keep the takeaway under 500 characters."),
});

export const PublicProfileSchema = z.object({
  handle: z.string(),
  title: z.string().nullable(),
  bio: z.string().nullable(),
  enabled: z.boolean(),
  indexable: z.boolean(),
  showFooter: z.boolean(),
  showStats: z.boolean(),
  buildingVisibility: z.enum(["off", "numbers", "highlights"]),
  showAgentModels: z.boolean(),
  headline: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(PublicLinkSchema),
  skills: z.array(z.string()),
  interests: z.array(z.string()),
  experience: z.array(PublicExperienceSchema),
  projects: z.array(PublicProjectSchema),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const PublicStatsSchema = z.object({
  since: dateTime.describe("When they started reading with Aeyhey."),
  daysActive: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  linksRead: z.number(),
  takeaways: z.number(),
  minutesRead: z.number(),
  activity: z.object({
    start: z.string().describe("The first day, YYYY-MM-DD in UTC."),
    counts: z.array(z.number()).describe("One count per day from start, 182 days."),
  }),
  topics: z.array(z.object({ name: z.string(), count: z.number() })),
  sources: z.array(z.object({ name: z.string(), count: z.number() })),
  milestones: z.array(
    z.object({
      kind: z.enum(["streak", "links", "takeaways", "hours", "days"]),
      value: z.number(),
      label: z.string(),
      reachedOn: z.string().nullable().optional().describe("YYYY-MM-DD, UTC."),
    }),
  ),
  streakStart: z.string().nullable().describe("First day of the current streak, YYYY-MM-DD."),
  recent: z
    .object({ links: z.number(), minutes: z.number(), days: z.number(), takeaways: z.number() })
    .describe("Growth over the last 30 days."),
});

export const PublicBuildingSchema = z
  .object({
    daysBuilding: z.number(),
    sessions: z.number(),
    activeMinutes: z.number(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
    languages: z.array(z.string()),
    recent: z.object({ minutes: z.number(), days: z.number() }),
    models: z.array(z.object({ name: z.string(), share: z.number() })).nullable(),
    tokens: z.number().nullable(),
  })
  .describe("Work with coding agents, as the owner chose to show it (PRD 29.3).");

export const PublicPageSettingsResponseSchema = z.object({
  profile: PublicProfileSchema.nullable().describe("Null until the page has been set up."),
  url: z.string().nullable().describe("Where the page lives. Null until it has a handle."),
  urlPrefix: z
    .string()
    .describe('Every page address starts with this, for example "https://aeyhey.com/u/".'),
  sharedCount: z.number().describe("Links on the page now."),
  suggestedHandle: z.string().nullable().describe("A free handle built from the user's name."),
  stats: PublicStatsSchema.nullable().describe("What the page's stats show. Null before setup."),
  building: PublicBuildingSchema.nullable().describe(
    "What the page shows of work with coding agents. Null when that is off.",
  ),
});

export const SharedLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  siteName: z.string().nullable(),
  takeaway: z.string(),
  readAt: dateTime.nullable(),
  sharedAt: dateTime,
});

export const SharedLinkListResponseSchema = z.object({
  items: z.array(SharedLinkSchema),
  nextCursor: z.string().nullable(),
});

export const HandleCheckResponseSchema = z.object({
  handle: z.string().describe("The handle as it would be saved: trimmed and lowercased."),
  available: z.boolean(),
  problem: z.string().nullable().describe("Why it cannot be used, for the person typing it."),
});

export const ProfilePatchSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Give your name.")
      .max(80, "Keep your name to 80 characters.")
      .optional(),
    avatar: z
      .string()
      .max(720_000, "That picture is too big. Pick a smaller one.")
      .nullable()
      .optional()
      .describe(
        "A data URL of a JPEG, PNG or WebP, cropped square and shrunk by the client. Null removes the picture.",
      ),
  })
  .refine((body) => body.displayName !== undefined || body.avatar !== undefined, {
    message: "Send a new name, a picture, or both.",
    path: ["displayName"],
  });

export const ProfileResponseSchema = z.object({
  displayName: z.string(),
  avatarUrl: z
    .string()
    .nullable()
    .describe("Where your picture is served, changing whenever it does. Null with none."),
});

const PublicDaySchema = z.object({
  day: z.string(),
  learned: z.array(
    z.object({
      text: z.string(),
      title: z.string().nullable(),
      url: z.string(),
      site: z.string().nullable(),
    }),
  ),
  built: z
    .object({
      done: z.array(z.string()),
      progress: z.array(z.string()),
      learned: z.array(z.string()),
    })
    .nullable(),
});

const OwnerDaySchema = PublicDaySchema.extend({
  learned: z.array(
    z.object({
      text: z.string(),
      title: z.string().nullable(),
      url: z.string(),
      site: z.string().nullable(),
      linkId: z.string().describe("Pass to POST /links/{id}/share to edit the takeaway."),
    }),
  ),
});

export const OwnerPageDaysResponseSchema = z.object({
  days: z.array(OwnerDaySchema),
  nextCursor: z.string().nullable().describe("Pass as before for the next days. Null when done."),
});

export const PublicDaysResponseSchema = z.object({
  days: z.array(PublicDaySchema),
  nextCursor: z.string().nullable().describe("Pass as before for the next days. Null when done."),
});

export const PublicPageResponseSchema = z.object({
  handle: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable().describe("The owner's picture, or null with none."),
  title: z.string(),
  bio: z.string().nullable(),
  indexable: z.boolean(),
  showFooter: z.boolean(),
  items: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullable(),
      site: z.string().nullable(),
      takeaway: z.string(),
      readAt: dateTime.nullable(),
      sharedAt: dateTime,
    }),
  ),
  nextCursor: z.string().nullable(),
  headline: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(PublicLinkSchema),
  skills: z.array(z.string()),
  interests: z.array(z.string()),
  experience: z.array(PublicExperienceSchema),
  projects: z.array(PublicProjectSchema),
  stats: PublicStatsSchema.nullable().describe(
    "Null when hidden by the owner, and after page one.",
  ),
  days: z
    .array(PublicDaySchema)
    .describe(
      "The newest seven days of learning: takeaways, and agent work when the owner shows it.",
    ),
  nextDaysCursor: z
    .string()
    .nullable()
    .describe("Pass as before to GET /u/{handle}/days for older days. Null when there are none."),
  building: PublicBuildingSchema.nullable(),
});

export const ResumeDraftResponseSchema = z.object({
  headline: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(PublicExperienceSchema),
  projects: z.array(PublicProjectSchema),
});

// ---------------------------------------------------------------- agent highlights (PRD 29)

const count = z.number().int().min(0).max(1e12);

/** A short name, such as a tool, model, skill or file extension. Never a path or content. */
const metaName = z.string().regex(/^[\w.:@+#<>-]{1,100}$/, "Names only, never paths.");
const countMap = (max: number) =>
  z.record(metaName, count).refine((map) => Object.keys(map).length <= max, {
    message: `At most ${max} entries.`,
  });

/** Counts and names only (PRD 29.2). Strict, like the session around it. */
export const AgentSessionDetailsSchema = z.strictObject({
  client: z
    .strictObject({
      version: z.string().max(40).optional(),
      entrypoint: z.string().max(40).optional(),
      platform: z.string().max(40).optional(),
    })
    .optional(),
  models: z
    .record(
      metaName,
      z.strictObject({ input: count, output: count, cache: count, messages: count }),
    )
    .refine((map) => Object.keys(map).length <= 20, { message: "At most 20 models." })
    .optional(),
  prompts: count.optional(),
  turns: count.optional(),
  toolCalls: countMap(150).optional(),
  toolErrors: count.optional(),
  apiErrors: count.optional(),
  compactions: count.optional(),
  subagentTurns: count.optional(),
  skills: countMap(50).optional(),
  plugins: countMap(50).optional(),
  mcpServers: countMap(50).optional(),
  modes: countMap(10).optional(),
  effort: countMap(10).optional(),
  serverTools: countMap(20).optional(),
  languages: countMap(60).optional(),
  linesAdded: count.optional(),
  linesRemoved: count.optional(),
  busyMinutes: count.optional(),
  thinkingSeconds: count.optional(),
  apiSeconds: count.optional(),
  toolSeconds: count.optional(),
  costUsd: z.number().min(0).max(1_000_000).optional(),
  endReason: z.string().max(40).optional(),
  /** Only sent when the person opted in on their machine. */
  title: z.string().max(200).optional(),
});

/**
 * One finished agent session. Strict on purpose (PRD 29.4 FR-AG-2): a hook that sends a
 * prompt, a transcript or any other field is refused, so nothing beyond this list can
 * reach the server.
 */
export const AgentSignalSchema = z.strictObject({
  sessionId: z.string().trim().min(1).max(200),
  tool: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use a short lowercase name, such as claude-code."),
  repo: z.string().trim().max(120).nullable().optional(),
  branch: z.string().trim().max(200).nullable().optional(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  tokens: z
    .strictObject({ input: count.optional(), output: count.optional(), cache: count.optional() })
    .optional(),
  filesChanged: z.number().int().min(0).max(1_000_000).optional(),
  commits: z.array(z.string().max(2_000)).max(200).optional(),
  details: AgentSessionDetailsSchema.optional(),
});

export const PinHighlightSchema = z.strictObject({
  text: z.string().trim().min(1, "Write what to keep.").max(280, "Keep it to 280 characters."),
  repo: z.string().trim().max(120).nullable().optional(),
});

export const HighlightPatchSchema = z
  .strictObject({
    text: z.string().trim().min(1).max(280).optional(),
    status: z.enum(["kept", "dropped", "draft"]).optional(),
    hiddenFromPage: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.text !== undefined || body.status !== undefined || body.hiddenFromPage !== undefined,
    {
      message: "Send new text, a status, or whether it shows on your profile.",
      path: ["status"],
    },
  );

export const DraftHighlightsSchema = z.strictObject({
  /** YYYY-MM-DD. Defaults to today in the person's timezone. */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const AgentTokenSchema = z.strictObject({
  name: z.string().trim().min(1, "Name the agent or machine.").max(80),
});

export const HighlightSchema = z.object({
  id: z.string(),
  day: z.string(),
  text: z.string(),
  kind: z.enum(["shipped", "progress", "learned", "pinned"]),
  status: z.enum(["draft", "kept", "dropped"]),
  repo: z.string().nullable(),
  hiddenFromPage: z.boolean(),
});

export const HighlightListResponseSchema = z.object({ highlights: z.array(HighlightSchema) });

export const AgentStatsResponseSchema = z.object({
  days: z.array(
    z.object({
      day: z.string(),
      sessions: z.number(),
      activeMinutes: z.number().describe("Union of session time: parallel sessions count once."),
      agentMinutes: z.number().describe("Plain sum of session time."),
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheTokens: z.number(),
      tools: z.record(z.string(), z.object({ sessions: z.number(), tokens: z.number() })),
      details: z
        .looseObject({})
        .describe("Models, tool calls, lines changed, languages and more, added up for the day."),
    }),
  ),
  daysBuilding: z.number().describe("Days with at least one kept highlight."),
  today: z.string(),
});

export const AgentTokenResponseSchema = z.object({
  token: z.string().describe("Shown once. Only reports agent sessions and highlights."),
  tokenId: z.string(),
  expiresAt: dateTime,
});
