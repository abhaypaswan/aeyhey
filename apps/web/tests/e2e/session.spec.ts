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
    const start = page.getByRole("button", { name: /start session/i });
    const caughtUp = page.getByText(/all caught up/i);
    await expect(start.or(caughtUp).first()).toBeVisible();

    await expect(page.getByText(/to read/i)).toBeVisible();
  });

  test("a session shows one card at a time with its own actions", async ({ page }) => {
    await page.goto("/session");

    // Progress is always "n of m", never a bare number.
    await expect(page.getByText(/\d+ of \d+/)).toBeVisible();

    const linkActions = page.getByRole("button", { name: "Read now" });
    const questionActions = page.getByRole("button", { name: "Answer" });
    await expect(linkActions.or(questionActions).first()).toBeVisible();
  });

  test("acting on a link card advances the session and offers an undo", async ({ page }) => {
    await page.goto("/session");

    // Wait for the card to be on screen before asking what kind it is: isVisible() does
    // not wait, so asking too early answers "no link here" while one is still rendering.
    // The skip below is then a real one, meaning this session opened on a question.
    const later = page.getByRole("button", { name: "Later" });
    const answer = page.getByRole("button", { name: "Answer" });
    await expect(later.or(answer).first()).toBeVisible();

    if (!(await later.isVisible())) {
      test.skip(true, "This session opened with a question card.");
    }

    const first = await page.getByText(/\d+ of \d+/).innerText();
    await later.click();

    // Undo is available for ten seconds after any action.
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+/)).not.toHaveText(first);
  });

  test("answering a question gives a score and the model answer", async ({ page }) => {
    await page.goto("/session");

    // Walk forward until a question card comes up.
    for (let i = 0; i < 5; i += 1) {
      if (
        await page
          .getByRole("button", { name: "Answer" })
          .isVisible()
          .catch(() => false)
      )
        break;
      const later = page.getByRole("button", { name: "Later" });
      if (!(await later.isVisible().catch(() => false))) break;
      await later.click();
      await page.waitForTimeout(300);
    }

    const answer = page.getByRole("button", { name: "Answer" });
    if (!(await answer.isVisible().catch(() => false))) {
      test.skip(true, "No question card in this session.");
    }

    await answer.click();
    await page
      .getByPlaceholder(/answer in your own words/i)
      .fill("A shared token bucket in Redis, updated atomically, with a retry-after header.");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByText(/out of 100/)).toBeVisible();
    await expect(page.getByText("Model answer", { exact: true })).toBeVisible();
    // All four ratings, with one pre-selected.
    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
  });

  test("the inbox lists the seeded links and filters by status", async ({ page }) => {
    await page.goto("/inbox");

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Postgres|SQLite|distributed/i }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: /^Snoozed/ }).click();
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

    await expect(page.getByRole("button", { name: /start a session/i })).toBeVisible();
    await expect(page.getByText("Model answer", { exact: true }).first()).toBeVisible();
  });

  test("adding links counts them before saving", async ({ page }) => {
    await page.goto("/add");

    // Unique URLs per run: both Playwright projects share one database, and a link that
    // is already saved reports a duplicate rather than a save.
    const run = Date.now();
    const box = page.getByPlaceholder(/https:\/\/example\.com/);
    await box.fill(
      `https://example.com/e2e-${run}-one\nhttps://example.com/e2e-${run}-two\nnot a link at all`,
    );

    // The live count is what makes a big paste feel safe.
    await expect(page.getByText(/2 links found/)).toBeVisible();

    await page.getByRole("button", { name: /save 2 links/i }).click();
    await expect(page.getByText(/saved 2 links/i)).toBeVisible();
  });

  test("stats draws the charts without any telemetry", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
    await expect(page.getByText(/due over the next 30 days/i)).toBeVisible();
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
