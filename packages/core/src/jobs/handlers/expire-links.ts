// SPDX-License-Identifier: AGPL-3.0-only
// expire_links: apply the expiry rules (PRD 9.4).
//
// Runs on a schedule rather than on every action, because the rules are about a pattern
// over time (snoozed five times, ignored three sessions, unread for 180 days) and none of
// them can be decided at the moment of a single tap.

import { and, eq, inArray } from "drizzle-orm";
import { decideExpiry, type ExpiryCandidate } from "../../scheduler/expiry";
import { scopeFor } from "../../repos/context";
import { findCardForItem, saveCardAfterAction } from "../../repos/cards";
import { updateLink } from "../../repos/links";
import { snapshot } from "../../scheduler/scheduler";
import type { HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:expire_links");

export async function expireLinksHandler(ctx: HandlerContext): Promise<void> {
  const { users, settings, links } = ctx.handle.schema;
  const now = new Date();

  // No user id on the payload: this is a system job that sweeps every user.
  const allUsers = await ctx.handle.db.select({ id: users.id }).from(users);

  for (const user of allUsers) {
    const scope = scopeFor(ctx.handle, user.id);

    const settingRows = await ctx.handle.db
      .select()
      .from(settings)
      .where(eq(settings.userId, user.id))
      .limit(1);
    const setting = settingRows[0];
    if (!setting || !setting.expiryEnabled) continue;

    const candidates = await ctx.handle.db
      .select()
      .from(links)
      .where(and(eq(links.userId, user.id), inArray(links.status, ["unread", "snoozed"])));

    let markedExpiring = 0;
    let expired = 0;

    for (const link of candidates) {
      const candidate: ExpiryCandidate = {
        linkId: link.id,
        status: link.status,
        snoozeCount: link.snoozeCount,
        ignoredCount: link.ignoredCount,
        rescued: link.rescued,
        savedAt: link.savedAt,
        importedAt: link.importedAt,
        // A link nobody has been shown yet cannot have been ignored, and the age rule
        // requires at least one showing.
        everShown: link.snoozeCount > 0 || link.ignoredCount > 0,
      };

      const decision = decideExpiry({
        candidate,
        settings: {
          expiryEnabled: setting.expiryEnabled,
          expiryMaxSnoozes: setting.expiryMaxSnoozes,
          expiryMaxIgnored: setting.expiryMaxIgnored,
          expiryUnreadDays: setting.expiryUnreadDays,
        },
        now,
      });

      if (decision.action === "none") continue;

      const nextStatus = decision.action === "expire" ? "expired" : "expiring";
      await updateLink(scope, link.id, { status: nextStatus });

      // The card mirrors the link's status, and the move is recorded so the session
      // summary can say "3 links expired this week" (PRD 9.4 rule 5).
      const card = await findCardForItem(scope, { type: "link", id: link.id });
      if (card) {
        const before = snapshot(card);
        await saveCardAfterAction(scope, {
          card: { ...card, status: nextStatus },
          action: "expire",
          before,
          channel: "web",
        });
      }

      if (decision.action === "expire") expired += 1;
      else markedExpiring += 1;
    }

    if (markedExpiring > 0 || expired > 0) {
      log.info("applied the expiry rules", { userId: user.id, markedExpiring, expired });
    }
  }
}
