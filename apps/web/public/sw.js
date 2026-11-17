// SPDX-License-Identifier: AGPL-3.0-only
// The service worker (PRD 14.2, 8.1 FR-LINK-6).
//
// Deliberately small. It does three things:
//   1. shows a push notification
//   2. opens the session when one is tapped, reusing an open tab if there is one
//   3. serves the shell when the network is gone, so an installed app does not show the
//      browser's offline page
//
// There is no caching of API responses. A stale session would be worse than a spinner:
// the user could act on a card that is no longer due.

const SHELL_CACHE = "aeyhey-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Aeyhey", body: "You have cards ready.", url: "/session" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // A push with no JSON body still shows the default.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // One tag per session, so a second notification replaces the first rather than
      // stacking up on the lock screen.
      tag: payload.tag || "aeyhey-session",
      renotify: false,
      data: { url: payload.url || "/session" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/session";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that is already open rather than piling up windows.
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only navigations are handled. Everything else, the API especially, goes straight to
  // the network: a cached session would let the user act on stale cards.
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (
        (await cache.match("/")) ??
        new Response(
          "<!doctype html><title>Offline</title><p>Aeyhey needs a connection for this.</p>",
          { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
        )
      );
    }),
  );
});
