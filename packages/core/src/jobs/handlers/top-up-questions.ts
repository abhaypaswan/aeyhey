// SPDX-License-Identifier: AGPL-3.0-only
// top_up_questions: write the questions for the next reminder (see questions/top-up.ts).
//
// The shortfall is worked out when the job runs, not when it was queued, so a retry after
// a partial failure only writes what is still missing.

import { findSource, listDecks, unseenQuestionsByDeck } from "../../repos/questions";
import { scopeFor } from "../../repos/context";
import { loadSettings } from "../../repos/settings";
import { planTopUp } from "../../questions/top-up";
import { writeQuestionsForDeck } from "./generate-questions";
import { requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:top_up_questions");

/** Decks Aeyhey can write more for: the ones made from a source. */
const TOP_UP_KINDS = new Set(["topics", "resume", "document"]);

export async function topUpQuestionsHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const scope = scopeFor(ctx.handle, userId);

  const settings = await loadSettings(scope);
  const decks = await listDecks(scope);
  const unseen = await unseenQuestionsByDeck(scope);

  // A paused deck is not asked, so its unseen questions do not count towards the target
  // and Aeyhey writes nothing new for it.
  const unseenTotal = decks
    .filter((deck) => !deck.pausedAt)
    .reduce((sum, deck) => sum + (unseen.get(deck.id) ?? 0), 0);
  const candidates = decks
    .filter((deck) => deck.sourceId && TOP_UP_KINDS.has(deck.kind) && !deck.pausedAt)
    .map((deck) => ({
      deckId: deck.id,
      sourceId: deck.sourceId!,
      unseen: unseen.get(deck.id) ?? 0,
    }));

  const plan = planTopUp({ target: settings.maxNewQuestions, unseenTotal, decks: candidates });
  if (plan.length === 0) return;

  let failed: Error | null = null;
  let written = 0;
  for (const entry of plan) {
    const deck = candidates.find((candidate) => candidate.deckId === entry.deckId)!;
    const source = await findSource(scope, deck.sourceId);
    if (!source) continue;
    try {
      written += await writeQuestionsForDeck({
        ai: ctx.ai,
        scope,
        source,
        deckId: deck.deckId,
        count: entry.count,
        jobId: ctx.job.id,
      });
    } catch (error) {
      // One deck failing should not stop the others. The job still fails afterwards, so
      // the retry writes whatever is still missing.
      failed = error as Error;
      log.warn("could not top up a deck", { deckId: deck.deckId, error: failed.message });
    }
  }

  log.info("topped up questions", { userId, planned: plan.length, written });
  if (failed) throw failed;
}
