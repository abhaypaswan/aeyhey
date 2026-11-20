// SPDX-License-Identifier: AGPL-3.0-only
// Web push in this browser: whether it can, whether it is on, and turning it on or off.
// Shared by the Notifications tab in Settings and the Notifications page, so both turn
// push on the same way.

import { apiClient } from "./client";

export type WebPushState = "unsupported" | "off" | "on";

/**
 * The browser wants the VAPID key as bytes, not base64url. The explicit ArrayBuffer is
 * needed because Uint8Array's buffer type is ArrayBufferLike, which includes
 * SharedArrayBuffer, and applicationServerKey will not accept that.
 */
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return registration ? registration.pushManager.getSubscription() : null;
}

/** What this browser is doing about push right now. */
export async function webPushState(): Promise<WebPushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/**
 * Asks for permission, subscribes this browser and tells the server about it. Throws with
 * a message a person can act on when it cannot.
 */
export async function enableWebPush(): Promise<void> {
  if (!supported()) {
    throw new Error(
      "This browser does not support web push. On iPhone, add Aeyhey to your home screen first.",
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Notifications are blocked for this site. Allow them in your browser settings.",
    );
  }

  const { publicKey } = await apiClient.get<{ publicKey: string | null }>(
    "/api/push/vapid-public-key",
  );
  if (!publicKey) throw new Error("Push is not set up on this instance.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // A subscription the browser already has is sent again, so a browser that was
  // subscribed before (or for another account) is saved for this one too.
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  await apiClient.post("/api/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  });
}

/** Stops push to this browser, on the server and in the browser. */
export async function disableWebPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await apiClient.delete("/api/push/subscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/**
 * What to check when a test was sent but nothing appeared. The push service accepting it
 * means the browser got it; the usual reason it does not show is the operating system
 * blocking that browser's notifications, or a Focus or Do Not Disturb mode.
 */
export function notShowingHint(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Microsoft Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Google Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "your browser";
  if (/Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua)) {
    return `Nothing showed up? Your Mac may be blocking ${browser}'s notifications. Check System Settings, Notifications, ${browser}, and that no Focus mode is on.`;
  }
  if (/Windows/.test(ua)) {
    return `Nothing showed up? Windows may be blocking ${browser}'s notifications. Check Settings, System, Notifications, ${browser}, and that Do not disturb is off.`;
  }
  if (/Android/.test(ua)) {
    return `Nothing showed up? Android may be blocking ${browser}'s notifications. Check its app notification settings and Do Not Disturb.`;
  }
  return "Nothing showed up? Your device may be blocking notifications from this browser, or a Focus or Do Not Disturb mode may be on.";
}
