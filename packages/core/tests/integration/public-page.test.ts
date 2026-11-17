// SPDX-License-Identifier: AGPL-3.0-only
// The "What I learned" public page (PRD 28): setting it up, sharing and unsharing links,
// and the public read, which must show exactly what was shared and nothing else.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { loadEnv } from "../../src/env";
import { buildRegistry } from "../../src/extensions/registry";
import { createLocalSingleUserAuth, createOwner } from "../../src/extensions/defaults/local-auth";
import { createEnvAndUserKeyProvider } from "../../src/extensions/defaults/env-user-keys";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { createApi, type Api } from "../../src/api/handlers";
import { scopeFor } from "../../src/repos/context";
import { saveLinks, updateLink } from "../../src/repos/links";
import {
  handleProblem,
  movedHandle,
  publicPageByHandle,
  savePublicProfile,
  shareLink,
} from "../../src/repos/public-page";

const BASE = "http://localhost:3000";
const APP_SECRET = "s".repeat(48);

let db: TestDb;
let dataDir: string;
let api: Api;
let ownerId: string;
let cookie: string;

function request(method: string, path: string, body?: unknown, withCookie = true): Request {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (withCookie) headers.set("cookie", cookie);
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Saves a link and marks it read, returning its id. */
async function readLink(userId: string, url: string, note?: string): Promise<string> {
  const scope = scopeFor(db.handle, userId);
  const saved = await saveLinks(scope, { text: url, note: note ?? null });
  const id = saved.created[0]!.id;
  await updateLink(scope, id, { status: "read", readAt: new Date() });
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-public-page-"));
  const owner = await createOwner({
    handle: db.handle,
    password: "a-good-password",
    displayName: "Abhay Paswan",
  });
  ownerId = owner.id;

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
  });
  api = createApi({ handle: db.handle, env, registry, appSecret: APP_SECRET });

  const headers = new Headers();
  await auth.signIn!({ password: "a-good-password" }, { headers });
  cookie = headers.get("set-cookie")!.split(";")[0]!;
});

afterEach(async () => {
  await db.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("handles", () => {
  it("accepts plain names and refuses bad, reserved and doubled-hyphen ones", () => {
    expect(handleProblem("abhay")).toBeNull();
    expect(handleProblem("abhay-p2")).toBeNull();
    expect(handleProblem("ab")).not.toBeNull();
    expect(handleProblem("-abhay")).not.toBeNull();
    expect(handleProblem("abhay_p")).not.toBeNull();
    expect(handleProblem("Abhay")).not.toBeNull();
    expect(handleProblem("ab--hay")).not.toBeNull();
    expect(handleProblem("www")).not.toBeNull();
    expect(handleProblem("admin")).not.toBeNull();
  });

  it("suggests one from the name before setup, and checks availability", async () => {
    const before = await body(await api.getPublicPage(request("GET", "/api/public-page")));
    expect(before.profile).toBeNull();
    expect(before.url).toBeNull();
    expect(before.suggestedHandle).toBe("abhay-paswan");

    const check = await body(
      await api.checkHandle(request("GET", "/api/public-page/handle-check?handle=@Abhay")),
    );
    expect(check).toEqual({ handle: "abhay", available: true, problem: null });

    const reserved = await body(
      await api.checkHandle(request("GET", "/api/public-page/handle-check?handle=admin")),
    );
    expect(reserved.available).toBe(false);
    expect(reserved.problem).toMatch(/reserved/);
  });

  it("will not give one handle to two users", async () => {
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay" });

    const { users } = db.handle.schema;
    await db.handle.db.insert(users).values({ id: "other-user", displayName: "Other" });
    const other = scopeFor(db.handle, "other-user");
    await expect(savePublicProfile(other, { handle: "abhay" })).rejects.toThrow(/already has/);
  });
});

describe("setting up the page", () => {
  it("needs a handle first, stays off until turned on, and returns its address", async () => {
    const noHandle = await api.updatePublicPage(
      request("PATCH", "/api/public-page", { enabled: true }),
    );
    expect(noHandle.status).toBe(400);

    const saved = await body(
      await api.updatePublicPage(
        request("PATCH", "/api/public-page", { handle: "Abhay", bio: "  Notes on systems  " }),
      ),
    );
    expect(saved.url).toBe(`${BASE}/u/abhay`);
    const profile = saved.profile as Record<string, unknown>;
    expect(profile.handle).toBe("abhay");
    expect(profile.enabled).toBe(false);
    expect(profile.bio).toBe("Notes on systems");

    // Off means a visitor sees nothing, the same as no page at all.
    expect(
      (await api.publicPage("abhay")(request("GET", "/api/u/abhay", undefined, false))).status,
    ).toBe(404);

    await api.updatePublicPage(request("PATCH", "/api/public-page", { enabled: true }));
    expect(
      (await api.publicPage("abhay")(request("GET", "/api/u/abhay", undefined, false))).status,
    ).toBe(200);
  });
});

describe("sharing links", () => {
  beforeEach(async () => {
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay", enabled: true });
  });

  it("only shares read links, and shows exactly the shared ones to a visitor", async () => {
    const read = await readLink(ownerId, "https://example.com/indexes", "private note");
    const alsoRead = await readLink(ownerId, "https://example.com/caching");
    const scope = scopeFor(db.handle, ownerId);
    const unread = (await saveLinks(scope, { text: "https://example.com/unread" })).created[0]!.id;

    const refused = await api.shareLink(unread)(
      request("POST", `/api/links/${unread}/share`, { takeaway: "Not yet" }),
    );
    expect(refused.status).toBe(409);

    const shared = await api.shareLink(read)(
      request("POST", `/api/links/${read}/share`, {
        takeaway: "  Index the columns you filter on.  ",
      }),
    );
    expect(shared.status).toBe(200);

    const page = await body(
      await api.publicPage("abhay")(request("GET", "/api/u/abhay", undefined, false)),
    );
    const items = page.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]!.takeaway).toBe("Index the columns you filter on.");
    expect(items[0]!.site).toBe("example.com");
    // The page shape is narrow on purpose: no ids, no notes, nothing about scheduling.
    expect(Object.keys(items[0]!).sort()).toEqual(
      ["readAt", "sharedAt", "site", "takeaway", "title", "url"].sort(),
    );
    expect(JSON.stringify(page)).not.toContain("private note");
    expect(JSON.stringify(page)).not.toContain(alsoRead);

    const mine = await body(await api.listSharedLinks(request("GET", "/api/public-page/links")));
    expect((mine.items as unknown[]).length).toBe(1);
    const settings = await body(await api.getPublicPage(request("GET", "/api/public-page")));
    expect(settings.sharedCount).toBe(1);
  });

  it("keeps the first share date when the takeaway is edited", async () => {
    const id = await readLink(ownerId, "https://example.com/a");
    const first = await body(
      await api.shareLink(id)(request("POST", `/api/links/${id}/share`, { takeaway: "One" })),
    );
    const second = await body(
      await api.shareLink(id)(request("POST", `/api/links/${id}/share`, { takeaway: "Two" })),
    );
    expect(second.sharedAt).toBe(first.sharedAt);
  });

  it("unshares at once, and hides a shared link moved off read", async () => {
    const a = await readLink(ownerId, "https://example.com/a");
    const b = await readLink(ownerId, "https://example.com/b");
    await shareLink(scopeFor(db.handle, ownerId), a, "A");
    await shareLink(scopeFor(db.handle, ownerId), b, "B");

    await api.unshareLink(a)(request("DELETE", `/api/links/${a}/share`));
    await updateLink(scopeFor(db.handle, ownerId), b, { status: "dropped" });

    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page!.items).toHaveLength(0);
  });

  it("never shows another user's links, even with their ids", async () => {
    const { users } = db.handle.schema;
    await db.handle.db.insert(users).values({ id: "other-user", displayName: "Other" });
    const theirs = await readLink("other-user", "https://example.com/theirs");

    // The owner cannot share someone else's link by guessing its id.
    const res = await api.shareLink(theirs)(
      request("POST", `/api/links/${theirs}/share`, { takeaway: "Mine now" }),
    );
    expect(res.status).toBe(404);

    // And their shared link stays off the owner's page.
    await shareLink(scopeFor(db.handle, "other-user"), theirs, "Theirs");
    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page!.items).toHaveLength(0);
  });

  it("pages through items newest first", async () => {
    for (let i = 0; i < 23; i += 1) {
      const id = await readLink(ownerId, `https://example.com/p${i}`);
      await shareLink(scopeFor(db.handle, ownerId), id, `Takeaway ${i}`);
    }
    const first = await publicPageByHandle(db.handle, "abhay");
    expect(first!.items).toHaveLength(20);
    expect(first!.nextCursor).not.toBeNull();
    const second = await publicPageByHandle(db.handle, "abhay", { cursor: first!.nextCursor });
    expect(second!.items).toHaveLength(3);
    expect(second!.nextCursor).toBeNull();
    const all = [...first!.items, ...second!.items].map((item) => item.url);
    expect(new Set(all).size).toBe(23);
  });
});

describe("changing the handle", () => {
  it("redirects the old one for 30 days and keeps it from anyone else meanwhile", async () => {
    const owner = scopeFor(db.handle, ownerId);
    await savePublicProfile(owner, { handle: "abhay", enabled: true });
    await savePublicProfile(owner, { handle: "abhay-p" });

    expect(await movedHandle(db.handle, "abhay")).toBe("abhay-p");
    const res = await api.publicPage("abhay")(request("GET", "/api/u/abhay", undefined, false));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/api/u/abhay-p");

    const { users } = db.handle.schema;
    await db.handle.db.insert(users).values({ id: "other-user", displayName: "Other" });
    const other = scopeFor(db.handle, "other-user");
    await expect(savePublicProfile(other, { handle: "abhay" })).rejects.toThrow(/already has/);

    // After 30 days the old name is free and stops redirecting.
    const { publicProfiles } = db.handle.schema;
    await db.handle.db
      .update(publicProfiles)
      .set({ handleChangedAt: new Date(Date.now() - 31 * 86_400_000) });
    expect(await movedHandle(db.handle, "abhay")).toBeNull();
    await expect(savePublicProfile(other, { handle: "abhay" })).resolves.toMatchObject({
      handle: "abhay",
    });
  });

  it("lets the owner take their old handle back", async () => {
    const owner = scopeFor(db.handle, ownerId);
    await savePublicProfile(owner, { handle: "abhay", enabled: true });
    await savePublicProfile(owner, { handle: "abhay-p" });
    const back = await savePublicProfile(owner, { handle: "abhay" });
    expect(back.handle).toBe("abhay");
    expect(await movedHandle(db.handle, "abhay-p")).toBe("abhay");
  });

  it("does not redirect to a page that is off", async () => {
    const owner = scopeFor(db.handle, ownerId);
    await savePublicProfile(owner, { handle: "abhay", enabled: false });
    await savePublicProfile(owner, { handle: "abhay-p" });
    expect(await movedHandle(db.handle, "abhay")).toBeNull();
  });
});

describe("the work side of the page", () => {
  it("shows headline, links, skills, experience and projects once filled in", async () => {
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay", enabled: true });
    const res = await api.updatePublicPage(
      request("PATCH", "/api/public-page", {
        headline: "Backend engineer",
        location: "Bengaluru",
        links: [{ label: "GitHub", url: "https://github.com/example" }],
        skills: ["Postgres", "postgres", " Go "],
        interests: ["Distributed systems"],
        experience: [{ role: "Engineer", company: "Acme", start: "2023", end: null }],
        projects: [
          {
            name: "Aeyhey",
            description: "Spaced repetition",
            url: "https://aeyhey.com",
            tech: ["TypeScript"],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);

    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page!.headline).toBe("Backend engineer");
    expect(page!.links).toEqual([{ label: "GitHub", url: "https://github.com/example" }]);
    // Trimmed, and repeats dropped regardless of case.
    expect(page!.skills).toEqual(["Postgres", "Go"]);
    expect(page!.experience[0]!.company).toBe("Acme");
    expect(page!.projects[0]!.url).toBe("https://aeyhey.com");
  });

  it("refuses a link that is not a web address", async () => {
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay", enabled: true });
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "github.com/x"]) {
      const res = await api.updatePublicPage(
        request("PATCH", "/api/public-page", { links: [{ label: "Bad", url }] }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("drafts the work side from the newest resume, and says so when there is none", async () => {
    const none = await api.resumeDraft(request("GET", "/api/public-page/resume-draft"));
    expect(none.status).toBe(404);

    const { questionSources } = db.handle.schema;
    await db.handle.db.insert(questionSources).values({
      id: "resume-1",
      userId: ownerId,
      kind: "resume",
      resumeProfile: {
        headline: "Senior backend engineer",
        years_experience: 6,
        skills: [
          { name: "Go", category: "language" },
          { name: "Postgres", category: "database" },
        ],
        experiences: [
          {
            company: "Acme",
            role: "Engineer",
            start: "2021",
            end: null,
            highlights: ["Built the billing service."],
          },
        ],
        projects: [{ name: "Queue", summary: "A job queue on Postgres.", tech: ["Go"] }],
        likely_interview_areas: [],
      },
    } as never);

    const res = await api.resumeDraft(request("GET", "/api/public-page/resume-draft"));
    const draft = (await res.json()) as Record<string, unknown>;
    expect(draft.headline).toBe("Senior backend engineer");
    expect(draft.skills).toEqual(["Go", "Postgres"]);
    expect((draft.experience as { summary: string }[])[0]!.summary).toBe(
      "Built the billing service.",
    );
    // A draft saves nothing.
    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page).toBeNull();
  });
});

describe("name and picture", () => {
  // The smallest real PNG: one transparent pixel.
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const patch = (payload: unknown) => api.updateProfile(request("PATCH", "/api/profile", payload));

  it("changes the name, and the public page follows", async () => {
    const res = await patch({ displayName: "  Abhay P  " });
    expect(res.status).toBe(200);
    expect((await body(res)).displayName).toBe("Abhay P");
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay", enabled: true });
    expect((await publicPageByHandle(db.handle, "abhay"))?.name).toBe("Abhay P");

    expect((await patch({ displayName: "   " })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it("stores a picture by its real type, serves it, and removes it", async () => {
    const saved = await body(await patch({ avatar: PNG }));
    expect(saved.avatarUrl).toMatch(/^\/api\/profile\/avatar\?v=\d+$/);

    const own = await api.ownAvatar(request("GET", "/api/profile/avatar"));
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await own.arrayBuffer())[1]).toBe(0x50);

    // The public page shows it only while the page is on.
    await savePublicProfile(scopeFor(db.handle, ownerId), { handle: "abhay", enabled: true });
    expect((await publicPageByHandle(db.handle, "abhay"))?.avatarUrl).toMatch(
      /^\/u\/abhay\/avatar\?v=\d+$/,
    );
    const anon = () =>
      api.publicAvatar("abhay")(request("GET", "/u/abhay/avatar", undefined, false));
    expect((await anon()).status).toBe(200);
    await savePublicProfile(scopeFor(db.handle, ownerId), { enabled: false });
    expect((await anon()).status).toBe(404);

    const removed = await body(await patch({ avatar: null }));
    expect(removed.avatarUrl).toBeNull();
    expect((await api.ownAvatar(request("GET", "/api/profile/avatar"))).status).toBe(404);
  });

  it("refuses what is not a JPEG, PNG or WebP, whatever the data URL claims", async () => {
    const svg = `data:image/png;base64,${Buffer.from("<svg onload=alert(1)></svg>").toString("base64")}`;
    const res = await patch({ avatar: svg });
    expect(res.status).toBe(400);
    expect(((await body(res)).error as { code: string }).code).toBe("avatar_not_image");
    expect((await patch({ avatar: "https://example.com/me.png" })).status).toBe(400);

    const huge = `data:image/jpeg;base64,${Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(520 * 1024),
    ]).toString("base64")}`;
    expect((await patch({ avatar: huge })).status).toBe(400);
  });
});
