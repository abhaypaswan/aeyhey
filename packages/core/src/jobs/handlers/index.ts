// SPDX-License-Identifier: AGPL-3.0-only
// The handler map. Plugin handlers are merged on top of this by the worker (PRD 23.5).

import type { JobType } from "../../db/types";
import type { JobHandler } from "./types";
import { extractLinkHandler } from "./extract-link";
import { enrichLinkHandler } from "./enrich-link";
import { expireLinksHandler } from "./expire-links";
import { buildProfileHandler } from "./build-profile";
import { generateQuestionsHandler } from "./generate-questions";
import { sendReminderHandler } from "./send-reminder";
import { topUpQuestionsHandler } from "./top-up-questions";
import { digestAgentDayHandler } from "./digest-agent-day";

/**
 * Partial on purpose: a job whose type has no handler is failed with a message that says
 * so, rather than being silently dropped.
 */
export const CORE_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  extract_link: extractLinkHandler,
  enrich_link: enrichLinkHandler,
  expire_links: expireLinksHandler,
  build_profile: buildProfileHandler,
  generate_questions: generateQuestionsHandler,
  send_reminder: sendReminderHandler,
  top_up_questions: topUpQuestionsHandler,
  digest_agent_day: digestAgentDayHandler,
};

export * from "./types";
