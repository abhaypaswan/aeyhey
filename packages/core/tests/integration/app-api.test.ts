// SPDX-License-Identifier: AGPL-3.0-only
// The API a phone app uses: signing in through /connect, bearer tokens, devices and push,
// and GET /api/today. Run through the real handlers and a real database, so what is
// tested is what an app would see over HTTP.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { loadEnv } from "../../src/env";
import { buildRegistry } from "../../src/extensions/registry";
import {
  createLocalSingleUserAuth,
  createOwner,
  SESSION_COOKIE,
} from "../../src/extensions/defaults/local-auth";
import { createEnvAndUserKeyProvider } from "../../src/extensions/defaults/env-user-keys";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { pkceChallenge, withApiTokens } from "../../src/extensions/api-tokens";
import type { AeyheyPlugin } from "../../src/extensions/plugin";
import type { NativePushMessage, NativePushDevice } from "../../src/extensions/push-sender";
import { createApi, type Api } from "../../src/api/handlers";
import { createPushChannel } from "../../src/notify/push";
import { scopeFor } from "../../src/repos/context";
import { registerDevice } from "../../src/notify/devices";
import { saveLinks, updateLink } from "../../src/repos/links";
import { updateSettings } from "../../src/repos/settings";
import { createDeck } from "../../src/repos/questions";

const BASE = "http://localhost:3000";
const APP_SECRET = "s".repeat(48);
const REDIRECT = "aeyhey://auth";
const VERIFIER = "v".repeat(20) + "-verifier-that-is-long-enough-1234567";

let db: TestDb;
let dataDir: string;
let api: Api;
let ownerId: string;
let cookie: string;
let sent: { devices: NativePushDevice[]; message: NativePushMessage }[];
let goneTokens: Set<string>;

function setup(plugins: AeyheyPlugin[] = []) {
  const env = loadEnv({ DATA_DIR: dataDir, PUBLIC_URL: BASE, APP_SECRET });
  const auth = createLocalSingleUserAuth({
    handle: db.handle,
    appSecret: APP_SECRET,
    authMode: "password",
    publicUrl: BASE,
  });
  const registry = buildRegistry({
    defaults: {
      auth,
      aiKeys: createEnvAndUserKeyProvider({ handle: db.handle, env, appSecret: APP_SECRET }),
      usageGate: createAllowAllGate(),
      usageSink: createLocalUsageSink(db.handle),
    },
    plugins,
    wrapAuth: (provider) => withApiTokens(provider, { handle: db.handle }),
  });
  return {
    env,
    registry,
    api: createApi({ handle: db.handle, env, registry, appSecret: APP_SECRET }),
  };
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

/** The whole /connect dance, as the app and the browser would do it. */
async function signInApp(deviceName = "Test phone"): Promise<string> {
  const approved = await api.connectApprove(
    request("POST", "/api/auth/connect", {
      cookie,
      origin: BASE,
      body: {
        redirectUri: REDIRECT,
        codeChallenge: pkceChallenge(VERIFIER),
        codeChallengeMethod: "S256",
        deviceName,
        state: "abc",
      },
    }),
  );
  expect(approved.status).toBe(200);
  const { redirectTo } = (await approved.json()) as { redirectTo: string };
  const code = new URL(redirectTo).searchParams.get("code")!;

  const exchanged = await api.exchangeToken(
    request("POST", "/api/auth/token", {
      body: {
        grantType: "authorization_code",
        code,
        codeVerifier: VERIFIER,
        redirectUri: REDIRECT,
      },
    }),
  );
  expect(exchanged.status).toBe(200);
  const body = (await exchanged.json()) as { token: string; tokenType: string };
  expect(body.tokenType).toBe("Bearer");
  return body.token;
}

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-data-"));
  const owner = await createOwner({ handle: db.handle, password: "a-good-password" });
  ownerId = owner.id;

  sent = [];
  goneTokens = new Set();

  ({ api } = setup());

  const headers = new Headers();
  const auth = createLocalSingleUserAuth({
    handle: db.handle,
    appSecret: APP_SECRET,
    authMode: "password",
    publicUrl: BASE,
  });
  await auth.signIn!({ password: "a-good-password" }, { headers });
  cookie = headers.get("set-cookie")!.split(";")[0]!;
  expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
});

afterEach(async () => {
  await db.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("app sign-in through /connect", () => {
  it("hands out a token that works as a bearer header, with no cookie", async () => {
    const token = await signInApp();
    expect(token.startsWith("ahy_")).toBe(true);

    const res = await api.listTokens(request("GET", "/api/auth/tokens", { token }));
    expect(res.status).toBe(200);
    const { tokens } = (await res.json()) as { tokens: { name: string; current: boolean }[] };
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: "Test phone", current: true });
  });

  it("echoes state back and puts the code on the app's redirect", async () => {
    const res = await api.connectApprove(
      request("POST", "/api/auth/connect", {
        cookie,
        origin: BASE,
        body: {
          redirectUri: REDIRECT,
          codeChallenge: pkceChallenge(VERIFIER),
          codeChallengeMethod: "S256",
          deviceName: "Phone",
          state: "xyz 1",
        },
      }),
    );
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    const url = new URL(redirectTo);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("xyz 1");
    expect(url.searchParams.get("code")).toBeTruthy();
  });

  it("refuses a redirect that is not on the allowlist, even one that starts the same", async () => {
    for (const redirectUri of [
      "https://evil.example/cb",
      "aeyhey://auth.evil",
      "aeyhey://auth/x",
    ]) {
      const res = await api.connectApprove(
        request("POST", "/api/auth/connect", {
          cookie,
          origin: BASE,
          body: {
            redirectUri,
            codeChallenge: pkceChallenge(VERIFIER),
            codeChallengeMethod: "S256",
            deviceName: "Phone",
          },
        }),
      );
      expect(res.status, redirectUri).toBe(400);
    }
  });

  it("will not approve without a browser session", async () => {
    const res = await api.connectApprove(
      request("POST", "/api/auth/connect", {
        body: {
          redirectUri: REDIRECT,
          codeChallenge: pkceChallenge(VERIFIER),
          codeChallengeMethod: "S256",
          deviceName: "Phone",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("will not let one app approve another", async () => {
    const token = await signInApp();
    const res = await api.connectApprove(
      request("POST", "/api/auth/connect", {
        token,
        body: {
          redirectUri: REDIRECT,
          codeChallenge: pkceChallenge(VERIFIER),
          codeChallengeMethod: "S256",
          deviceName: "Second",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a code with the wrong verifier, a reused code, and the wrong redirect", async () => {
    const approve = async () => {
      const res = await api.connectApprove(
        request("POST", "/api/auth/connect", {
          cookie,
          origin: BASE,
          body: {
            redirectUri: REDIRECT,
            codeChallenge: pkceChallenge(VERIFIER),
            codeChallengeMethod: "S256",
            deviceName: "Phone",
          },
        }),
      );
      const { redirectTo } = (await res.json()) as { redirectTo: string };
      return new URL(redirectTo).searchParams.get("code")!;
    };
    const exchange = (code: string, codeVerifier: string, redirectUri = REDIRECT) =>
      api.exchangeToken(
        request("POST", "/api/auth/token", {
          body: { grantType: "authorization_code", code, codeVerifier, redirectUri },
        }),
      );

    const wrongVerifier = await approve();
    const bad = await exchange(wrongVerifier, "w".repeat(50));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_grant");
    // A failed attempt still burns the code, so it cannot be guessed at.
    expect((await exchange(wrongVerifier, VERIFIER)).status).toBe(400);

    const reused = await approve();
    expect((await exchange(reused, VERIFIER)).status).toBe(200);
    expect((await exchange(reused, VERIFIER)).status).toBe(400);

    const wrongRedirect = await approve();
    expect((await exchange(wrongRedirect, VERIFIER, "aeyhey://other")).status).toBe(400);
  });

  it("refuses an expired code", async () => {
    const { createAuthCode, exchangeAuthCode } = await import("../../src/extensions/api-tokens");
    const code = await createAuthCode(db.handle, {
      userId: ownerId,
      codeChallenge: pkceChallenge(VERIFIER),
      redirectUri: REDIRECT,
      deviceName: "Phone",
      now: new Date(Date.now() - 10 * 60 * 1000),
    });
    await expect(
      exchangeAuthCode(db.handle, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
    ).rejects.toThrow(/not valid/);
  });

  it("treats a bad bearer token as signed out, and never falls back to the cookie", async () => {
    const res = await api.today(request("GET", "/api/today", { token: "ahy_nonsense", cookie }));
    expect(res.status).toBe(401);
  });

  it("signs the app out on revoke, and on logout with its own token", async () => {
    const first = await signInApp("First");
    const second = await signInApp("Second");

    const list = (await (
      await api.listTokens(request("GET", "/api/auth/tokens", { cookie }))
    ).json()) as { tokens: { id: string; name: string }[] };
    const firstId = list.tokens.find((token) => token.name === "First")!.id;

    const revoked = await api.revokeToken(firstId)(
      request("DELETE", `/api/auth/tokens/${firstId}`, { cookie, origin: BASE }),
    );
    expect(revoked.status).toBe(200);
    expect((await api.today(request("GET", "/api/today", { token: first }))).status).toBe(401);
    expect((await api.today(request("GET", "/api/today", { token: second }))).status).toBe(200);

    const { registry } = setup();
    await registry.auth.signOut(request("POST", "/api/auth/logout", { token: second }), {
      headers: new Headers(),
    });
    expect((await api.today(request("GET", "/api/today", { token: second }))).status).toBe(401);
  });

  it("keeps the browser cookie working exactly as before", async () => {
    const res = await api.today(request("GET", "/api/today", { cookie }));
    expect(res.status).toBe(200);
  });
});

describe("devices and native push", () => {
  const sender: AeyheyPlugin = {
    name: "test-push",
    pushSender: {
      id: "test",
      async send(devices, message) {
        sent.push({ devices, message });
        return devices.map((device) => ({
          deviceId: device.id,
          ok: !goneTokens.has(device.pushToken),
          gone: goneTokens.has(device.pushToken),
        }));
      },
    },
  };

  it("registers a device, and moves a push token to whoever signs in on that phone", async () => {
    const token = await signInApp();
    const res = await api.registerDevice(
      request("POST", "/api/devices", {
        token,
        body: { platform: "ios", pushToken: "push-1", appVersion: "1.0.0" },
      }),
    );
    expect(res.status).toBe(200);
    // No sender in the community build: registered, but nothing will be sent.
    expect(((await res.json()) as { pushEnabled: boolean }).pushEnabled).toBe(false);

    const other = await createOtherUser();
    await registerDevice(scopeFor(db.handle, other), { platform: "ios", pushToken: "push-1" });
    const rows = await db.handle.db.select().from(db.handle.schema.devices);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(other);
  });

  it("removes a phone's devices when its token is revoked", async () => {
    const token = await signInApp();
    await api.registerDevice(
      request("POST", "/api/devices", { token, body: { platform: "android", pushToken: "p" } }),
    );
    const { tokens } = (await (
      await api.listTokens(request("GET", "/api/auth/tokens", { token }))
    ).json()) as { tokens: { id: string }[] };
    await api.revokeToken(tokens[0]!.id)(request("DELETE", "/x", { cookie, origin: BASE }));
    const rows = await db.handle.db.select().from(db.handle.schema.devices);
    expect(rows).toHaveLength(0);
  });

  it("sends reminders through the plugin's sender, and drops tokens the service calls gone", async () => {
    const { registry } = setup([sender]);
    expect(registry.pushSender?.id).toBe("test");

    const scope = scopeFor(db.handle, ownerId);
    await registerDevice(scope, { platform: "ios", pushToken: "alive" });
    await registerDevice(scope, { platform: "android", pushToken: "dead" });
    goneTokens.add("dead");

    const channel = createPushChannel({
      handle: db.handle,
      vapid: null,
      publicUrl: BASE,
      nativeSender: registry.pushSender,
    });
    expect(channel.isConfigured()).toBe(true);
    expect(await channel.isEnabledFor(ownerId)).toBe(true);

    const result = await channel.sendTest(ownerId);
    expect(result).toEqual({ ok: true, messagesSent: 1 });
    expect(sent[0]!.message.path).toBe("/");
    expect(sent[0]!.devices.map((device) => device.pushToken).sort()).toEqual(["alive", "dead"]);

    const rows = await db.handle.db.select().from(db.handle.schema.devices);
    expect(rows.map((row) => row.pushToken)).toEqual(["alive"]);
  });

  it("is not configured with neither web push nor a sender", () => {
    const channel = createPushChannel({ handle: db.handle, vapid: null, publicUrl: BASE });
    expect(channel.isConfigured()).toBe(false);
  });

  async function createOtherUser(): Promise<string> {
    const id = "01OTHERUSER000000000000000";
    await db.handle.db.insert(db.handle.schema.users).values({
      id,
      email: "other@example.com",
      passwordHash: null,
      displayName: "Other",
      timezone: "UTC",
      role: "member",
      createdAt: new Date(),
    });
    return id;
  }
});

describe("GET /api/today", () => {
  it("returns what the home screen needs", async () => {
    await saveLinks(scopeFor(db.handle, ownerId), { text: "https://example.com/a" });

    const res = await api.today(request("GET", "/api/today", { cookie }));
    expect(res.status).toBe(200);
    const today = (await res.json()) as Record<string, unknown>;

    for (const key of [
      "due",
      "sessionSize",
      "paused",
      "nextSessionAt",
      "nextSessionLabel",
      "links",
      "streak",
      "week",
      "queue",
      "hasPushDevice",
    ]) {
      expect(today, key).toHaveProperty(key);
    }
    expect(today["linkTotal"]).toBe(1);
    expect(today["week"]).toHaveLength(7);
    expect(Number.isNaN(Date.parse(today["nextSessionAt"] as string))).toBe(false);
  });
});

describe("lifeLeft on links", () => {
  type Item = { id: string; url: string; status: string; lifeLeft: number | null };

  async function list(): Promise<Item[]> {
    const res = await api.listLinks(request("GET", "/api/links?sort=oldest", { cookie }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: Item[] }).items;
  }

  it("is on the list and on a single link, from the user's own limits", async () => {
    const s = scopeFor(db.handle, ownerId);
    const saved = await saveLinks(s, {
      text: "https://example.com/fresh https://example.com/snoozed https://example.com/read",
    });
    const [fresh, snoozed, read] = saved.created.map((link) => link.id);
    await updateSettings(s, { expiryMaxSnoozes: 4 });
    await updateLink(s, snoozed!, { status: "snoozed", snoozeCount: 3 });
    await updateLink(s, read!, { status: "read" });

    const items = await list();
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(fresh!)!.lifeLeft).toBe(1);
    expect(byId.get(snoozed!)!.lifeLeft).toBeCloseTo(0.25);
    expect(byId.get(read!)!.lifeLeft).toBeNull();
    // The counters feed lifeLeft but are not part of the list item.
    expect(byId.get(fresh!)).not.toHaveProperty("snoozeCount");

    const one = await api.getLink(snoozed!)(request("GET", `/api/links/${snoozed}`, { cookie }));
    expect(one.status).toBe(200);
    const { link } = (await one.json()) as { link: Item };
    expect(link.lifeLeft).toBeCloseTo(0.25);
  });

  it("is null everywhere when expiry is off", async () => {
    const s = scopeFor(db.handle, ownerId);
    const saved = await saveLinks(s, { text: "https://example.com/a" });
    await updateSettings(s, { expiryEnabled: false });

    expect((await list()).map((item) => item.lifeLeft)).toEqual([null]);
    const id = saved.created[0]!.id;
    const one = await api.getLink(id)(request("GET", `/api/links/${id}`, { cookie }));
    expect(((await one.json()) as { link: Item }).link.lifeLeft).toBeNull();
  });
});

describe("PATCH /api/decks/{id}", () => {
  type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string[]> } };

  function rename(deckId: string, body: unknown) {
    return api.renameDeck(deckId)(
      request("PATCH", `/api/decks/${deckId}`, { cookie, origin: BASE, body }),
    );
  }

  async function newDeck(kind: "manual" | "links" = "manual") {
    return createDeck(scopeFor(db.handle, ownerId), { name: "Old name", kind });
  }

  it("renames a deck and answers with it as GET /decks lists it", async () => {
    const deck = await newDeck();
    const res = await rename(deck.id, { name: "System design" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deck: Record<string, unknown> };
    expect(body.deck).toMatchObject({ id: deck.id, name: "System design", kind: "manual" });

    const listed = await api.listDecks(request("GET", "/api/decks", { cookie }));
    const { decks } = (await listed.json()) as { decks: Record<string, unknown>[] };
    expect(body.deck).toEqual(decks.find((d) => d.id === deck.id));
  });

  it("trims the name", async () => {
    const deck = await newDeck();
    const res = await rename(deck.id, { name: "   Graphs  " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deck: { name: string } }).deck.name).toBe("Graphs");
  });

  it("refuses an empty name, even one that is only spaces", async () => {
    const deck = await newDeck();
    for (const name of ["", "    "]) {
      const res = await rename(deck.id, { name });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.fields?.["name"]).toBeDefined();
    }
  });

  it("refuses a name over 120 characters, and takes one of exactly 120", async () => {
    const deck = await newDeck();
    const tooLong = await rename(deck.id, { name: "a".repeat(121) });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as ErrorBody).error.code).toBe("invalid_request");

    const exact = await rename(deck.id, { name: "a".repeat(120) });
    expect(exact.status).toBe(200);
  });

  it("will not rename the built-in links deck", async () => {
    const deck = await newDeck("links");
    const res = await rename(deck.id, { name: "Reading" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("deck_not_renamable");
  });

  it("answers 404 for another user's deck, and leaves it alone", async () => {
    const otherId = "user-two";
    await db.handle.db.insert(db.handle.schema.users).values({
      id: otherId,
      displayName: "Other",
      timezone: "UTC",
      role: "member",
      createdAt: new Date(),
    });
    const theirs = await createDeck(scopeFor(db.handle, otherId), {
      name: "Theirs",
      kind: "manual",
    });

    const res = await rename(theirs.id, { name: "Mine now" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe("not_found");

    const rows = await db.handle.db.select().from(db.handle.schema.decks);
    expect(rows.find((row) => row.id === theirs.id)!.name).toBe("Theirs");
  });
});

describe("login rate limit", () => {
  it("limits each client on its own, so one guesser does not lock out everyone", async () => {
    const auth = createLocalSingleUserAuth({
      handle: db.handle,
      appSecret: APP_SECRET,
      authMode: "password",
      publicUrl: BASE,
    });
    const attempt = (clientIp: string) =>
      auth.signIn!({ password: "wrong", clientIp }, { headers: new Headers() }).catch(
        (error: Error) => error.name,
      );

    for (let i = 0; i < 5; i += 1) await attempt("10.0.0.1");
    expect(await attempt("10.0.0.1")).toBe("TooManyAttemptsError");
    expect(await attempt("10.0.0.2")).toBe("UnauthorizedError");
  });
});

describe("pausing with no end date", () => {
  it("stays paused, shows no date, and resumes on request", async () => {
    const paused = await api.pause(
      request("POST", "/api/settings/pause", { cookie, body: { indefinite: true } }),
    );
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ pausedUntil: null, pausedIndefinitely: true });

    const today = (await (await api.today(request("GET", "/api/today", { cookie }))).json()) as {
      paused: boolean;
      pausedUntil: string | null;
      pausedIndefinitely: boolean;
    };
    expect(today).toMatchObject({ paused: true, pausedUntil: null, pausedIndefinitely: true });

    const settings = (await (
      await api.getSettings(request("GET", "/api/settings", { cookie }))
    ).json()) as { settings: { pausedUntil: string | null; pausedIndefinitely: boolean } };
    expect(settings.settings).toMatchObject({ pausedUntil: null, pausedIndefinitely: true });

    await api.resume(request("POST", "/api/settings/resume", { cookie }));
    const after = (await (await api.today(request("GET", "/api/today", { cookie }))).json()) as {
      paused: boolean;
      pausedIndefinitely: boolean;
    };
    expect(after).toMatchObject({ paused: false, pausedIndefinitely: false });
  });
});

describe("deleting the account from the app", () => {
  it("asks for the typed confirmation first", async () => {
    const res = await api.deleteAccount(
      request("DELETE", "/api/account", { cookie, body: { confirm: "yes" } }),
    );
    expect(res.status).toBe(400);
  });

  it("deletes the data, and keeps a single-user owner who cannot be removed", async () => {
    await saveLinks(scopeFor(db.handle, ownerId), { text: "https://example.com/a" });
    const res = await api.deleteAccount(
      request("DELETE", "/api/account", { cookie, body: { confirm: "delete my account" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountDeleted: false });
    const today = (await (await api.today(request("GET", "/api/today", { cookie }))).json()) as {
      linkTotal: number;
    };
    expect(today.linkTotal).toBe(0);
  });

  it("removes the account itself where the sign-in provider can", async () => {
    const { env, registry } = setup();
    const removed: string[] = [];
    const hosted = createApi({
      handle: db.handle,
      env,
      registry: {
        ...registry,
        auth: {
          ...registry.auth,
          deleteAccount: async (userId: string) => {
            removed.push(userId);
          },
        },
      },
      appSecret: APP_SECRET,
    });
    const res = await hosted.deleteAccount(
      request("DELETE", "/api/account", { cookie, body: { confirm: "delete my account" } }),
    );
    expect(await res.json()).toMatchObject({ accountDeleted: true });
    expect(removed).toEqual([ownerId]);
  });

  it("is refused on a demo server", async () => {
    const env = loadEnv({ DATA_DIR: dataDir, PUBLIC_URL: BASE, APP_SECRET, DEMO_MODE: "true" });
    const { registry } = setup();
    const demo = createApi({ handle: db.handle, env, registry, appSecret: APP_SECRET });
    const res = await demo.deleteAccount(
      request("DELETE", "/api/account", { cookie, body: { confirm: "delete my account" } }),
    );
    expect(res.status).toBe(403);
  });
});
