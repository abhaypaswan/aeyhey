// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import {
  connectTelegramChat,
  disconnectTelegramChat,
  findTelegramConnection,
  findUserByChat,
} from "../../src/notify/telegram";
import { createTestDb, type TestDb } from "../helpers/db";

describe("Telegram account connection", () => {
  let db: TestDb;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = (await createOwner({ handle: db.handle, password: "a-good-password" })).id;
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it("reports the current connection and clears it on disconnect", async () => {
    await connectTelegramChat(db.handle, {
      userId,
      chatId: "telegram-123",
      username: "learner",
    });

    expect(await findUserByChat(db.handle, "telegram-123")).toBe(userId);
    expect(await findTelegramConnection(db.handle, userId)).toMatchObject({
      chatId: "telegram-123",
      username: "learner",
    });

    await disconnectTelegramChat(db.handle, userId);
    expect(await findUserByChat(db.handle, "telegram-123")).toBeNull();
    expect(await findTelegramConnection(db.handle, userId)).toBeNull();
  });
});
