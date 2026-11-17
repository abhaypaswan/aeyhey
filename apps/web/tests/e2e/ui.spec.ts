// SPDX-License-Identifier: AGPL-3.0-only
// The controls built on UI SDK: the command palette, the settings tabs and the selects.
//
// These assert on roles and keyboard, not on classes. The point of moving these off
// hand-rolled markup was the behaviour underneath, so that is what is checked here.

import { expect, test, type Page } from "@playwright/test";

test.describe("the command palette", () => {
  test("opens on the keyboard, filters, and runs what you pick", async ({ page }) => {
    await page.goto("/inbox");

    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();

    const input = page.getByRole("combobox", { name: /search commands/i });
    await expect(input).toBeFocused();

    // The groups are what makes a long list readable.
    await expect(page.getByText("Do", { exact: true })).toBeVisible();
    await expect(page.getByText("Go to", { exact: true })).toBeVisible();

    await input.fill("deck");
    await expect(page.getByRole("option", { name: /new deck from topics/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /start a session/i })).toHaveCount(0);

    // Escape clears the query first and closes only once there is nothing to clear,
    // which is what a palette with a search field in it should do.
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    await expect(palette).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("sits over the page rather than in a corner of it", async ({ page }) => {
    await page.goto("/inbox");
    await page.keyboard.press("ControlOrMeta+k");

    const box = await page.getByRole("dialog").boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) return;

    // Centred horizontally, within a pixel of rounding, and clear of the top edge.
    const centreOffset = Math.abs(box.x - (viewport.width - box.width) / 2);
    expect(centreOffset).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(0);
  });
});

test.describe("settings controls", () => {
  test("the tabs are real tabs, with arrow keys", async ({ page }) => {
    await page.goto("/settings");

    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Notifications" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("a setting that takes effect at once is a switch, not a checkbox", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Link rules" }).click();

    const expire = page.getByRole("switch", { name: /let links expire/i });
    await expect(expire).toBeVisible();

    const before = await expire.getAttribute("aria-checked");
    await expire.click();
    await expect(expire).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  });

  test("choosing from a select changes what the trigger reads", async ({ page }) => {
    await page.goto("/settings");

    const mix = page.getByRole("combobox", { name: /the mix/i });
    await expect(mix).toHaveText(/let aeyhey decide/i);

    await mix.click();
    await page.getByRole("option", { name: /i will choose/i }).click();

    await expect(mix).toHaveText(/i will choose/i);
    // Choosing it reveals the fields it controls.
    await expect(page.getByLabel("Links per session", { exact: true })).toBeVisible();
  });
});

test.describe("the session", () => {
  // The whole run shares one throwaway database, and a session is finite, so by the time
  // these run the earlier tests may have left nothing to act on. Putting every link back
  // first is what the inbox's own Restore does, and it makes these tests say the same
  // thing whichever order or project they run in.
  test.beforeEach(async ({ request }) => {
    const listed = await request.get("/api/links?limit=100");
    const body = (await listed.json()) as { items?: { id: string }[] };
    const ids = (body.items ?? []).map((item) => item.id);
    if (ids.length > 0) {
      await request.post("/api/links/bulk", { data: { ids, action: "restore" } });
    }
  });

  // Whichever card is up, there is one action that schedules it and so offers an undo:
  // "Later" on a link, "Skip" on a question. Taking either keeps these tests working
  // whichever kind of card the session opens on.
  const anAction = (page: Page) =>
    page.getByRole("button", { name: "Later" }).or(page.getByRole("button", { name: "Skip" }));

  // Restoring the links is not enough on its own: a session that earlier tests finished
  // stays finished, and its end screen is what loads. "Do 5 more" builds another one
  // from the cards that are eligible again.
  async function openSessionWithACard(page: Page): Promise<void> {
    await page.goto("/session");
    const another = page.getByRole("button", { name: /do \d+ more/i });
    if (await another.isVisible().catch(() => false)) {
      await another.click();
    }
    await expect(anAction(page).first()).toBeVisible();
  }

  test("an action offers an undo in a toast, and taking it steps back", async ({ page }) => {
    await openSessionWithACard(page);

    const progress = page.getByText(/\d+ of \d+/);
    const before = await progress.textContent();

    await anAction(page).first().click();

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    await undo.click();
    await expect(undo).toBeHidden();
    await expect(progress).toHaveText(before ?? "");
  });

  test("only the most recent action can be undone", async ({ page }) => {
    await openSessionWithACard(page);

    await anAction(page).first().click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

    // The session may have run out of cards on the first action, in which case there is
    // no second one to take and nothing left to check here.
    try {
      await anAction(page).first().click({ timeout: 2000 });
    } catch {
      return;
    }

    // The earlier offer is withdrawn rather than left promising an undo it can no
    // longer carry out.
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(1);
  });
});

test.describe("deck detail", () => {
  test("filtering by difficulty is one control, not a row of buttons", async ({ page }) => {
    await page.goto("/decks");
    await page
      .getByRole("link")
      .filter({ hasText: /questions/ })
      .first()
      .click();

    const filter = page.getByRole("radiogroup", { name: /filter by difficulty/i });
    await expect(filter).toBeVisible();
    await expect(filter.getByRole("radio", { name: "All" })).toBeChecked();

    await filter.getByRole("radio", { name: "Hard" }).click();
    await expect(filter.getByRole("radio", { name: "Hard" })).toBeChecked();
  });

  test("the model answer opens and shuts", async ({ page }) => {
    await page.goto("/decks");
    await page
      .getByRole("link")
      .filter({ hasText: /questions/ })
      .first()
      .click();

    const trigger = page.getByRole("button", { name: "Model answer" }).first();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("deleting a question asks first, and cancelling keeps it", async ({ page }) => {
    await page.goto("/decks");
    await page
      .getByRole("link")
      .filter({ hasText: /questions/ })
      .first()
      .click();

    const questions = page.getByRole("listitem");
    const countBefore = await questions.count();

    await page.getByRole("button", { name: "Delete" }).first().click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/cannot be undone/i)).toBeVisible();

    await confirm.getByRole("button", { name: /keep it/i }).click();
    await expect(confirm).toBeHidden();
    await expect(questions).toHaveCount(countBefore);
  });
});
