// SPDX-License-Identifier: AGPL-3.0-only
// NativePushSender: how a reminder reaches a phone app.
//
// Core stores the push tokens phones register (the devices table) and decides when a
// reminder goes out. Actually sending to Apple or Google needs credentials for a specific
// app, so that part is a plugin's job. With no sender registered, devices can still
// register and nothing is sent to them, which is the community default.

import type { DevicePlatform } from "../db/types";

export interface NativePushDevice {
  id: string;
  platform: DevicePlatform;
  pushToken: string;
}

export interface NativePushMessage {
  title: string;
  body: string;
  /** A path inside the app, such as "/session". The app decides how to open it. */
  path: string;
  /** Messages with the same tag replace each other on the lock screen. */
  tag?: string;
}

export interface NativePushResult {
  deviceId: string;
  ok: boolean;
  /**
   * True when the push service says the token is dead for good (the app was
   * uninstalled). Core deletes that device instead of retrying it.
   */
  gone?: boolean;
  error?: string;
}

export interface NativePushSender {
  /** "fcm", "apns". */
  id: string;
  send(devices: NativePushDevice[], message: NativePushMessage): Promise<NativePushResult[]>;
}
