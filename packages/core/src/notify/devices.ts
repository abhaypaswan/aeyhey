// SPDX-License-Identifier: AGPL-3.0-only
// Phones registered for native push.
//
// The push token belongs to an app install, not to a person: if someone signs out and a
// second person signs in on the same phone, the same token arrives for a new user, and
// the row moves to them. That is why the upsert below rewrites user_id.

import { and, eq, lt } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { DevicePlatform } from "../db/types";
import type { Scope } from "../repos/context";
import { newId } from "../ids";

/** After this many consecutive failures, stop sending to a device. */
export const MAX_DEVICE_FAILURES = 5;

export interface RegisterDeviceInput {
  platform: DevicePlatform;
  pushToken: string;
  appVersion?: string | null | undefined;
  /** The app token the request came with, so revoking it removes this device too. */
  apiTokenId?: string | null | undefined;
}

export async function registerDevice(scope: Scope, input: RegisterDeviceInput): Promise<string> {
  const { devices } = scope.handle.schema;
  const now = new Date();
  const id = newId();

  const rows = await scope.handle.db
    .insert(devices)
    .values({
      id,
      userId: scope.userId,
      platform: input.platform,
      pushToken: input.pushToken,
      apiTokenId: input.apiTokenId ?? null,
      appVersion: input.appVersion ?? null,
      failCount: 0,
      lastOkAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: devices.pushToken,
      set: {
        userId: scope.userId,
        platform: input.platform,
        apiTokenId: input.apiTokenId ?? null,
        appVersion: input.appVersion ?? null,
        failCount: 0,
        updatedAt: now,
      },
    })
    .returning({ id: devices.id });

  return rows[0]?.id ?? id;
}

export async function unregisterDevice(scope: Scope, pushToken: string): Promise<void> {
  const { devices } = scope.handle.schema;
  await scope.handle.db
    .delete(devices)
    .where(and(eq(devices.userId, scope.userId), eq(devices.pushToken, pushToken)));
}

/** The devices still worth sending to. */
export async function listDevices(handle: DbHandle, userId: string) {
  const { devices } = handle.schema;
  return handle.db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), lt(devices.failCount, MAX_DEVICE_FAILURES)));
}
