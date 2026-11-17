// SPDX-License-Identifier: AGPL-3.0-only
// A reminder retried by the worker must sign its links with the same secret the web app
// verifies them with.
//
// The bug this guards against: send_reminder read process.env.APP_SECRET, which is empty
// when the secret was generated on first run and saved to DATA_DIR/secrets.json. Retried
// emails then carried links signed with an empty key, and every one of them failed.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { loadEnv } from "../../src/env";
import { buildRegistry } from "../../src/extensions/registry";
import { createOwner, createLocalSingleUserAuth } from "../../src/extensions/defaults/local-auth";
import { createEnvAndUserKeyProvider } from "../../src/extensions/defaults/env-user-keys";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { ensureAppSecret } from "../../src/security/crypto";
import { scopeFor } from "../../src/repos/context";
import { applyEnrichment, applyExtraction, saveLinks } from "../../src/repos/links";
import { getOrBuildSession } from "../../src/sessions/service";
import { enqueue } from "../../src/jobs/queue";
import * as channels from "../../src/notify/channels";
import { createWorker } from "../../src/jobs/worker";

let db: TestDb;
let dataDir: string;
const savedSecret = process.env.APP_SECRET;

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-secret-"));
  delete process.env.APP_SECRET;
});

afterEach(async () => {
  await db.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = savedSecret;
});

describe("send_reminder", () => {
  it("signs with the generated secret, not an empty one, when APP_SECRET is unset", async () => {
    const env = loadEnv({ DATA_DIR: dataDir });
    expect(env.APP_SECRET).toBeUndefined();
    // What the web app does on start: generate the secret and save it.
    const webSecret = ensureAppSecret({ dataDir, fromEnv: undefined });

    const owner = await createOwner({ handle: db.handle, password: "a-good-password" });
    const scope = scopeFor(db.handle, owner.id);
    const saved = await saveLinks(scope, { text: "https://example.com/post" });
    const linkId = saved.created[0]!.id;
    await applyExtraction(scope, linkId, {
      status: "ok",
      title: "A post",
      contentType: "article",
      text: "Enough real text for the link to count as extracted.",
      language: "en",
    });
    await applyEnrichment(scope, linkId, {
      aiStatus: "ok",
      summaryLines: ["One.", "Two.", "Three."],
      whySaved: "To read later.",
      summaryConfidence: "high",
      contentType: "article",
      readMinutes: 3,
      language: "en",
    });
    const session = await getOrBuildSession(scope, { trigger: "manual" });
    expect(session.session).not.toBeNull();

    // Capture the secret the handler builds its channels with. Returning no channels
    // makes the handler stop there, which is all this test needs.
    const seen: string[] = [];
    vi.spyOn(channels, "buildChannels").mockImplementation(async (input) => {
      seen.push(input.appSecret);
      return { channels: [], vapid: null, byId: new Map() };
    });

    await enqueue(db.handle, {
      type: "send_reminder",
      userId: owner.id,
      payload: { sessionId: session.session!.id, channel: "email" },
    });

    const registry = buildRegistry({
      defaults: {
        auth: createLocalSingleUserAuth({
          handle: db.handle,
          appSecret: webSecret,
          authMode: "password",
          publicUrl: env.PUBLIC_URL,
        }),
        aiKeys: createEnvAndUserKeyProvider({ handle: db.handle, env, appSecret: webSecret }),
        usageGate: createAllowAllGate(),
        usageSink: createLocalUsageSink(db.handle),
      },
    });

    // No appSecret passed, which is the case this test is about: the worker must find
    // the saved one rather than fall back to nothing.
    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 2,
      pollIntervalMs: 1,
      periodicWork: false,
    });
    await worker.run();

    expect(seen).toEqual([webSecret]);
    expect(webSecret.length).toBeGreaterThanOrEqual(32);
  });
});
