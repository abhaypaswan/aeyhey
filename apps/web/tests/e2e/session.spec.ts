// SPDX-License-Identifier: AGPL-3.0-only
// The flow a visitor actually tries first (PRD 18, 8.5).
//
// Against demo mode, so there is real seed data and no API key involved. These assert on
// what the user sees, not on implementation details, which is what makes them worth the
// time they take to run.

import { expect, test } from "@playwright/test";

test.describe("the demo flow", () => {
  test("health reports a working database", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);

    const body = (await response.json()) as { ok: boolean; db: boolean; dialect: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
  });

  test("Today offers a session and shows where you stand", async ({ page }) => {
    await page.goto("/");

    // Either there is something due, or the app says so plainly. Both are correct.
    const start = page.getByRole("link", { name: /start session/i });
    const caughtUp = page.getByText(/all caught up/i);
    await expect(start.or(caughtUp).first()).toBeVisible();

    await expect(
      page
        .getByRole("region", { name: "Where you stand" })
        .getByText(/waiting to be read|on last chance|nothing waiting/i),
    ).toBeVisible();
  });

  test("a session shows one card at a time with its own actions", async ({ page }) => {
    await page.goto("/session");

    // Progress is a strip with one segment per card, named "Card n of m".
    await expect(page.getByRole("img", { name: /card \d+ of \d+/i })).toBeVisible();

    const linkActions = page.getByRole("button", { name: "Read now" });
    const questionActions = page.getByRole("textbox", { name: /write your answer/i });
    await expect(linkActions.or(questionActions).first()).toBeVisible();
  });

  test("acting on a link card advances the session and offers an undo", async ({ page }) => {
    await page.goto("/session");

    // Wait for the card to be on screen before asking what kind it is: isVisible() does
    // not wait, so asking too early answers "no link here" while one is still rendering.
    // The skip below is then a real one, meaning this session opened on a question.
    const later = page.getByRole("button", { name: "Later" });
    const answer = page.getByRole("textbox", { name: /write your answer/i });
    await expect(later.or(answer).first()).toBeVisible();

    if (!(await later.isVisible())) {
      test.skip(true, "This session opened with a question card.");
    }

    const progress = page.getByRole("img", { name: /card \d+ of \d+/i });
    const first = await progress.getAttribute("aria-label");
    await later.click();

    // After any action a strip says when the card comes back, with Undo.
    await expect(page.getByRole("button", { name: /undo/i })).toBeVisible();
    await expect(progress).not.toHaveAttribute("aria-label", first ?? "");
  });

  test("answering a question gives a score and the model answer", async ({ page }) => {
    await page.goto("/session");

    // Walk forward until a question card comes up.
    for (let i = 0; i < 5; i += 1) {
      if (
        await page
          .getByRole("textbox", { name: /write your answer/i })
          .isVisible()
          .catch(() => false)
      )
        break;
      const later = page.getByRole("button", { name: "Later" });
      if (!(await later.isVisible().catch(() => false))) break;
      await later.click();
      await page.waitForTimeout(300);
    }

    const answer = page.getByRole("textbox", { name: /write your answer/i });
    if (!(await answer.isVisible().catch(() => false))) {
      test.skip(true, "No question card in this session.");
    }

    await answer.fill(
      "A shared token bucket in Redis, updated atomically, with a retry-after header.",
    );
    await page.getByRole("button", { name: /check my answer/i }).click();

    await expect(page.getByText(/out of 100/)).toBeVisible();
    await expect(page.getByText("Model answer", { exact: true })).toBeVisible();
    // All four ratings, with the suggested one already chosen.
    const ratings = page.getByRole("radiogroup", { name: /how well did you know it/i });
    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      await expect(ratings.getByRole("radio", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /^rate it/i })).toBeVisible();
  });

  test("the inbox lists the seeded links and filters by status", async ({ page }) => {
    await page.goto("/inbox");

    await expect(page.getByRole("searchbox", { name: /search your links/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Postgres|SQLite|distributed|fsrs|codebase/i }).first(),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: /filter your links/i })
      .getByRole("link", { name: /^Later/ })
      .click();
    await expect(page).toHaveURL(/status=snoozed/);
  });

  test("decks show their counts, and a deck shows its questions", async ({ page }) => {
    await page.goto("/decks");

    const deck = page
      .getByRole("link")
      .filter({ hasText: /questions/ })
      .first();
    await expect(deck).toBeVisible();
    await deck.click();

    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
    // A question is the front of a card; opening it turns it over to the model answer.
    await page.getByRole("region", { name: "Questions" }).locator("li button").first().click();
    await expect(page.getByText("Model answer", { exact: true }).first()).toBeVisible();
  });

  test("the assistant saves a link, proposes a deck and answers from the library", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const assistant = page.getByRole("region", { name: "Assistant" });
    const box = assistant.getByRole("textbox", { name: /message the assistant/i });

    // A link is saved at once. Unique per run: both projects share one database.
    await box.fill(`https://example.com/e2e-${Date.now()}`);
    await box.press("Enter");
    await expect(assistant.getByText(/Saved 1 link/)).toBeVisible();

    // Topics come back as a proposal; nothing is written until it is agreed.
    await box.fill("Photosynthesis, enzymes and osmosis");
    await box.press("Enter");
    await expect(assistant.getByRole("button", { name: /make it: 15 questions/i })).toBeVisible();

    // A question is answered from the library, with the pieces it used.
    await box.fill("What did I save about Kafka?");
    await box.press("Enter");
    await expect(assistant.getByRole("link", { name: /kafka/i }).first()).toBeVisible();
  });

  test("stats draws the charts without any telemetry", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
    await expect(page.getByRole("img", { name: /cards answered each day/i })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /cards due on each of the next 14 days/i }),
    ).toBeVisible();
  });

  test("settings saves a schedule change", async ({ page }) => {
    await page.goto("/settings");

    await page.getByLabel(/cards per session/i).fill("7");
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/cards per session/i)).toHaveValue("7");
  });
});
