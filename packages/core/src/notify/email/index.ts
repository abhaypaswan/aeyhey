// SPDX-License-Identifier: AGPL-3.0-only
// Email delivery (PRD 14.4, 17).
//
// One mail per session, to a verified address only. The one-tap action links are
// HMAC-signed, stored hashed, single use, and expire after 7 days, so a leaked mailbox
// cannot be replayed into someone's account a month later.

import { eq } from "drizzle-orm";
import type { DbHandle } from "../../db/client";
import { newId } from "../../ids";
import {
  hashToken,
  SEVEN_DAYS_MS,
  signToken,
  THIRTY_DAYS_MS,
  verifyToken,
} from "../../security/tokens";
import type { ReviewAction } from "../../db/types";
import {
  renderSessionEmailHtml,
  renderSessionEmailText,
  renderVerifyEmail,
  type EmailActionTokens,
  sessionEmailHeading,
} from "./templates";
import type { DeliveryPayload, DeliveryResult, NotificationChannel } from "../types";
import { createLogger } from "../../logger";

const log = createLogger("email");

export interface EmailChannelOptions {
  handle: DbHandle;
  smtpUrl?: string | undefined;
  from: string;
  publicUrl: string;
  appSecret: string;
}

interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe, which every mail client expects. */
  unsubscribeUrl?: string;
}

async function sendMail(options: EmailChannelOptions, message: MailMessage): Promise<void> {
  if (!options.smtpUrl) throw new Error("No SMTP server is configured.");

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(options.smtpUrl);

  await transport.sendMail({
    from: options.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });
}

/** One-tap action tokens: signed, stored hashed, single use (PRD 14.4). */
async function mintActionTokens(
  options: EmailChannelOptions,
  userId: string,
  cardIds: string[],
): Promise<EmailActionTokens> {
  const { actionTokens } = options.handle.schema;
  const tokens: EmailActionTokens = { read: {}, later: {}, drop: {} };
  const rows: {
    tokenHash: string;
    userId: string;
    cardId: string;
    action: ReviewAction;
    expiresAt: Date;
    usedAt: null;
    createdAt: Date;
  }[] = [];

  const actions: { key: keyof EmailActionTokens; action: ReviewAction }[] = [
    { key: "read", action: "read" },
    { key: "later", action: "snooze" },
    { key: "drop", action: "drop" },
  ];

  for (const cardId of cardIds) {
    for (const { key, action } of actions) {
      const { token, expiresAt } = signToken({
        purpose: "email-action",
        payload: { userId, cardId, action },
        appSecret: options.appSecret,
        ttlMs: SEVEN_DAYS_MS,
      });
      tokens[key][cardId] = token;
      // Only the hash is stored, so a database dump cannot act on anyone's cards.
      rows.push({
        tokenHash: hashToken(token),
        userId,
        cardId,
        action,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      });
    }
  }

  if (rows.length > 0) {
    await options.handle.db.insert(actionTokens).values(rows).onConflictDoNothing();
  }

  return tokens;
}

export type ActionTokenResult =
  | { ok: true; userId: string; cardId: string; action: ReviewAction }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Verifies and burns a one-tap token. Single use is enforced here (PRD 14.4). */
export async function consumeActionToken(
  options: { handle: DbHandle; appSecret: string },
  token: string,
): Promise<ActionTokenResult> {
  const verified = verifyToken<{ userId: string; cardId: string; action: ReviewAction }>({
    purpose: "email-action",
    token,
    appSecret: options.appSecret,
  });

  if (!verified.ok) {
    return { ok: false, reason: verified.reason === "expired" ? "expired" : "invalid" };
  }

  const { actionTokens } = options.handle.schema;
  const hash = hashToken(token);

  const rows = await options.handle.db
    .select()
    .from(actionTokens)
    .where(eq(actionTokens.tokenHash, hash))
    .limit(1);
  const row = rows[0];

  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  await options.handle.db
    .update(actionTokens)
    .set({ usedAt: new Date() })
    .where(eq(actionTokens.tokenHash, hash));

  return { ok: true, userId: row.userId, cardId: row.cardId, action: row.action };
}

export async function requestEmailVerification(
  options: EmailChannelOptions,
  userId: string,
  address: string,
): Promise<void> {
  const { emailChannels } = options.handle.schema;

  const { token } = signToken({
    purpose: "email-verify",
    payload: { userId, address },
    appSecret: options.appSecret,
    ttlMs: SEVEN_DAYS_MS,
  });
  const { token: unsubscribeToken } = signToken({
    purpose: "email-unsubscribe",
    payload: { userId },
    appSecret: options.appSecret,
    ttlMs: THIRTY_DAYS_MS * 12,
  });

  await options.handle.db
    .insert(emailChannels)
    .values({
      userId,
      address,
      verifiedAt: null,
      verifyTokenHash: hashToken(token),
      unsubscribeTokenHash: hashToken(unsubscribeToken),
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailChannels.userId,
      // Changing the address un-verifies it, which is the whole point of verification.
      set: { address, verifiedAt: null, verifyTokenHash: hashToken(token) },
    });

  const mail = renderVerifyEmail({ publicUrl: options.publicUrl, token });
  await sendMail(options, { to: address, ...mail });

  log.info("sent a verification email", { userId });
}

export async function confirmEmail(
  options: { handle: DbHandle; appSecret: string },
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  const verified = verifyToken<{ userId: string; address: string }>({
    purpose: "email-verify",
    token,
    appSecret: options.appSecret,
  });
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason === "expired" ? "That link has expired." : "That link is not valid.",
    };
  }

  const { emailChannels } = options.handle.schema;
  const rows = await options.handle.db
    .select()
    .from(emailChannels)
    .where(eq(emailChannels.userId, verified.payload.userId))
    .limit(1);
  const row = rows[0];

  if (!row || row.verifyTokenHash !== hashToken(token)) {
    return { ok: false, reason: "That link has already been used." };
  }

  await options.handle.db
    .update(emailChannels)
    .set({ verifiedAt: new Date(), verifyTokenHash: null })
    .where(eq(emailChannels.userId, verified.payload.userId));

  return { ok: true };
}

export async function unsubscribeEmail(
  options: { handle: DbHandle; appSecret: string },
  token: string,
): Promise<{ ok: boolean }> {
  const verified = verifyToken<{ userId: string }>({
    purpose: "email-unsubscribe",
    token,
    appSecret: options.appSecret,
  });
  if (!verified.ok) return { ok: false };

  const { emailChannels } = options.handle.schema;
  await options.handle.db
    .delete(emailChannels)
    .where(eq(emailChannels.userId, verified.payload.userId));

  return { ok: true };
}

export function createEmailChannel(options: EmailChannelOptions): NotificationChannel {
  const { handle } = options;
  const { emailChannels } = handle.schema;

  async function verifiedAddress(userId: string): Promise<string | null> {
    const rows = await handle.db
      .select()
      .from(emailChannels)
      .where(eq(emailChannels.userId, userId))
      .limit(1);
    const row = rows[0];
    // An unverified address is never sent to, which is what stops Aeyhey being used to
    // mail strangers.
    return row?.verifiedAt ? row.address : null;
  }

  return {
    id: "email",

    isConfigured() {
      return Boolean(options.smtpUrl);
    },

    async isEnabledFor(userId) {
      return (await verifiedAddress(userId)) !== null;
    },

    async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
      const address = await verifiedAddress(payload.userId);
      if (!address) return { ok: false, error: "No verified email address." };

      const tokens = await mintActionTokens(
        options,
        payload.userId,
        payload.items.filter((item) => item.kind === "link").map((item) => item.cardId),
      );

      const { token: unsubscribeToken } = signToken({
        purpose: "email-unsubscribe",
        payload: { userId: payload.userId },
        appSecret: options.appSecret,
        ttlMs: THIRTY_DAYS_MS * 12,
      });
      const { token: pauseToken } = signToken({
        purpose: "email-action",
        payload: { userId: payload.userId, action: "pause" },
        appSecret: options.appSecret,
        ttlMs: SEVEN_DAYS_MS,
      });

      const input = {
        displayName: "",
        items: payload.items,
        publicUrl: payload.publicUrl,
        nextSessionLabel: payload.nextSessionLabel,
        tokens,
        unsubscribeToken,
        pauseToken,
        expiredSinceLast: payload.expiredSinceLast,
      };

      try {
        await sendMail(options, {
          to: address,
          subject: sessionEmailHeading(payload.items),
          html: renderSessionEmailHtml(input),
          text: renderSessionEmailText(input),
          unsubscribeUrl: `${payload.publicUrl}/api/email/unsubscribe?token=${unsubscribeToken}`,
        });
        return { ok: true, messagesSent: 1 };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },

    async sendTest(userId) {
      const address = await verifiedAddress(userId);
      if (!address) {
        return { ok: false, error: "Verify your address first, then try the test again." };
      }

      try {
        await sendMail(options, {
          to: address,
          subject: "Aeyhey is set up",
          text: "This is a test. Your session emails will arrive here.",
          html: `<p>This is a test. Your session emails will arrive here.</p>`,
        });
        return { ok: true, messagesSent: 1 };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  };
}

export { newId };
