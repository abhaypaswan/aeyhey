"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// A new account starts on UTC because the server cannot see where its owner is. The
// browser can. So the first time someone signs in on a browser while still on that
// default, this sets their timezone to the browser's, quietly. Settings can change it.
//
// It runs once per person per browser. Someone who saves UTC in Settings on purpose is
// marked too, so it never takes their choice back. If the browser gives no zone, or one
// the server refuses, UTC stays.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiRequestError } from "../lib/client";

const UTC_NAMES = new Set(["UTC", "Etc/UTC", "Etc/GMT", "GMT", "Etc/Universal", "Etc/Zulu"]);

/** One request per page load, even when React runs the effect twice. */
let sent = false;

function markerKey(userId: string): string {
  return `aeyhey.timezone-guessed.${userId}`;
}

/** Remembers that this person's timezone is settled on this browser. */
export function markTimezoneSettled(userId: string): void {
  try {
    window.localStorage.setItem(markerKey(userId), "1");
  } catch {
    // Storage can be blocked. The guess then runs again next time, which is harmless.
  }
}

function alreadySettled(userId: string): boolean {
  try {
    return window.localStorage.getItem(markerKey(userId)) === "1";
  } catch {
    return false;
  }
}

function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function TimezoneGuess({ userId, timezone }: { userId: string; timezone: string }) {
  const router = useRouter();

  useEffect(() => {
    if (sent || timezone !== "UTC" || alreadySettled(userId)) return;
    const guess = browserTimezone();
    if (!guess || UTC_NAMES.has(guess)) {
      markTimezoneSettled(userId);
      return;
    }
    sent = true;
    apiClient
      .patch("/api/settings", { timezone: guess })
      .then(() => {
        markTimezoneSettled(userId);
        router.refresh();
      })
      .catch((thrown: unknown) => {
        // The server refused the zone: keep UTC and do not ask again. A network error
        // is left unmarked, so the next page load tries once more.
        if (thrown instanceof ApiRequestError) markTimezoneSettled(userId);
      });
  }, [userId, timezone, router]);

  return null;
}
