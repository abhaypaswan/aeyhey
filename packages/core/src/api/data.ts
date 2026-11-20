// SPDX-License-Identifier: AGPL-3.0-only
// Export, import and delete everything (PRD 8.4 FR-SET-4, 17).
//
// The export is a portable backup and contains no secrets: no password hash, no encrypted
// API keys, no push subscription keys, no tokens. It is a file the user can keep, read and
// move to another instance.

import { eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { Scope } from "../repos/context";
import { withTransaction } from "../db/transaction";
import { createLogger } from "../logger";

const log = createLogger("data");

export const EXPORT_VERSION = 1;

export interface ExportBundle {
  version: number;
  exportedAt: string;
  app: "aeyhey";
  settings: unknown;
  links: unknown[];
  decks: unknown[];
  questionSources: unknown[];
  questions: unknown[];
  tags: unknown[];
  itemTags: unknown[];
  cards: unknown[];
  reviewLogs: unknown[];
  grades: unknown[];
  /** Journal lines and daily agent totals (PRD 29). Raw session signals are not exported. */
  agentHighlights: unknown[];
  agentDays: unknown[];
  /** The public page settings (PRD 28), null when the user never set one up. */
  publicProfile: unknown;
}

export async function exportEverything(scope: Scope): Promise<ExportBundle> {
  const s = scope.handle.schema;
  const userId = scope.userId;
  const all = async <T>(table: never, column: never): Promise<T[]> =>
    scope.handle.db.select().from(table).where(eq(column, userId)) as unknown as Promise<T[]>;

  const [settings] = await scope.handle.db
    .select()
    .from(s.settings)
    .where(eq(s.settings.userId, userId))
    .limit(1);

  const bundle: ExportBundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "aeyhey",
    settings: settings ?? null,
    links: await all(s.links as never, s.links.userId as never),
    decks: await all(s.decks as never, s.decks.userId as never),
    questionSources: await all(s.questionSources as never, s.questionSources.userId as never),
    questions: await all(s.questions as never, s.questions.userId as never),
    tags: await all(s.tags as never, s.tags.userId as never),
    itemTags: await all(s.itemTags as never, s.itemTags.userId as never),
    cards: await all(s.cards as never, s.cards.userId as never),
    reviewLogs: await all(s.reviewLogs as never, s.reviewLogs.userId as never),
    grades: await all(s.grades as never, s.grades.userId as never),
    // Highlights and daily totals, not the raw session signals (PRD 29.4 FR-AG-7).
    agentHighlights: await all(s.agentHighlights as never, s.agentHighlights.userId as never),
    agentDays: await all(s.agentDays as never, s.agentDays.userId as never),
    publicProfile:
      (
        await scope.handle.db
          .select()
          .from(s.publicProfiles)
          .where(eq(s.publicProfiles.userId, userId))
          .limit(1)
      )[0] ?? null,
  };

  // The resume text is personal, and an export is a file that gets emailed around. The
  // profile is kept because the questions reference it, but the raw text is not.
  bundle.questionSources = (bundle.questionSources as Record<string, unknown>[]).map((source) => ({
    ...source,
    resumeText: null,
    resumeFilePath: null,
  }));

  log.info("exported a user's data", {
    userId,
    links: bundle.links.length,
    questions: bundle.questions.length,
  });

  return bundle;
}

export interface DeleteResult {
  deletedRows: number;
  deletedFiles: number;
}

/**
 * Removes every row for this user and every file they uploaded (PRD 17).
 * The user row itself stays, because this is "delete my data", not "delete my account":
 * the account deletion path is the hosted edition's, and it calls this first.
 */
export async function deleteAllData(
  scope: Scope,
  options: { dataDir: string } = { dataDir: "/data" },
): Promise<DeleteResult> {
  const s = scope.handle.schema;
  const userId = scope.userId;
  let deletedRows = 0;

  // Children before parents, so nothing is left pointing at a row that is gone.
  const tables = [
    s.reviewLogs,
    s.sessionItems,
    s.sessions,
    s.grades,
    s.itemTags,
    s.tags,
    s.cards,
    s.questions,
    s.decks,
    s.questionSources,
    s.links,
    s.publicProfiles,
    s.userAvatars,
    s.agentSignals,
    s.agentDays,
    s.agentHighlights,
    s.notifications,
    s.pushSubscriptions,
    s.devices,
    s.authCodes,
    s.apiTokens,
    s.telegramMessages,
    s.telegramLinks,
    s.aiProviders,
    s.aiUsage,
    s.jobs,
  ];

  await withTransaction(scope.handle, async (tx) => {
    for (const table of tables) {
      const userColumn = (table as unknown as { userId?: unknown }).userId;
      if (!userColumn) continue;
      await tx.delete(table as never).where(eq(userColumn as never, userId));
      deletedRows += 1;
    }
  });

  // Uploads live under DATA_DIR/uploads/<userId>/, so the whole folder goes (PRD 23.7).
  let deletedFiles = 0;
  try {
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await rm(join(options.dataDir, "uploads", userId), { recursive: true, force: true });
    deletedFiles = 1;
  } catch {
    // No uploads folder, which is the normal case.
  }

  log.warn("deleted all data for a user", { userId });
  return { deletedRows, deletedFiles };
}

export async function countUserRows(handle: DbHandle, userId: string): Promise<number> {
  const { links, questions, cards } = handle.schema;
  const [l, q, c] = await Promise.all([
    handle.db.select().from(links).where(eq(links.userId, userId)),
    handle.db.select().from(questions).where(eq(questions.userId, userId)),
    handle.db.select().from(cards).where(eq(cards.userId, userId)),
  ]);
  return l.length + q.length + c.length;
}
