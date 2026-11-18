// SPDX-License-Identifier: AGPL-3.0-only
// The controls built on UI SDK: the command palette, the settings tabs and the selects.
//
// These assert on roles and keyboard, not on classes. The point of moving these off
// hand-rolled markup was the behaviour underneath, so that is what is checked here.

import { expect, test, type Page } from "@playwright/test";

test.describe("the command palette", () => {
  test("opens on the keyboard, filters, and runs what you pick", async ({ page }) => {
    await page.goto("/inbox");
    // The shortcut is listened for once the page has hydrated, which a long inbox delays.
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();

    const input = page.getByRole("combobox", { name: /search commands/i });
    await expect(input).toBeFocused();

    // The groups are what makes a long list readable.
    await expect(page.getByText("Do", { exact: true })).toBeVisible();
    await expect(page.getByText("Go to", { exact: true })).toBeVisible();

    await input.fill("map");
    await expect(page.getByRole("option", { name: /^map$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /start a session/i })).toHaveCount(0);
    // aey takes anything typed, so it stays, carrying the text.
    await expect(page.getByRole("option", { name: /ask aey.*map/i })).toBeVisible();

    // Escape clears the query first and closes only once there is nothing to clear,
    // which is what a palette with a search field in it should do.
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("");
    await expect(palette).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("hands what you typed to aey, once", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("ControlOrMeta+k");

    const input = page.getByRole("combobox", { name: /search commands/i });
    await input.fill("how does kafka keep order");
    await page.getByRole("option", { name: /ask aey/i }).click();

    // Home, with the question already sent, and an address that will not send it again.
    await expect(page).toHaveURL(/\/$/);
    const aey = page.getByRole("region", { name: "aey" });
    await expect(aey.getByText("how does kafka keep order")).toHaveCount(1);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(aey.getByText("how does kafka keep order")).toHaveCount(1);
  });

  test("sits over the page rather than in a corner of it", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();

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
    await expect(page.getByRole("tab", { name: "Account" })).toHaveAttribute(
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

    const progress = page.getByRole("img", { name: /card \d+ of \d+/i });
    const before = await progress.getAttribute("aria-label");

    await anAction(page).first().click();

    const undo = page.getByRole("button", { name: /undo/i });
    await expect(undo).toBeVisible();

    await undo.click();
    await expect(undo).toBeHidden();
    await expect(progress).toHaveAttribute("aria-label", before ?? "");
  });

  test("only the most recent action can be undone", async ({ page }) => {
    await openSessionWithACard(page);

    await anAction(page).first().click();
    await expect(page.getByRole("button", { name: /undo/i })).toBeVisible();

    // The session may have run out of cards on the first action, in which case there is
    // no second one to take and nothing left to check here.
    try {
      await anAction(page).first().click({ timeout: 2000 });
    } catch {
      return;
    }

    // The earlier offer is withdrawn rather than left promising an undo it can no
    // longer carry out.
    await expect(page.getByRole("button", { name: /undo/i })).toHaveCount(1);
  });
});

test.describe("deck detail", () => {
  async function openADeck(page: Page): Promise<void> {
    // Decks are listed on Home; there is no page of their own.
    await page.goto("/");
    await page
      .getByRole("region", { name: "Your decks" })
      .getByRole("link")
      .filter({ hasText: /questions/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  }

  test("questions filter by how far along they are", async ({ page }) => {
    await openADeck(page);

    const filters = page.getByRole("navigation", { name: /filter questions/i });
    await expect(filters.getByRole("button", { name: /^All/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await filters.getByRole("button", { name: /^Learned/ }).click();
    await expect(filters.getByRole("button", { name: /^Learned/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(filters.getByRole("button", { name: /^All/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("a question turns over to its model answer, and back", async ({ page }) => {
    await openADeck(page);

    const trigger = page.getByRole("region", { name: "Questions" }).locator("li button").first();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("removing a question asks first, and cancelling keeps it", async ({ page }) => {
    await openADeck(page);

    // Counted once the first question is open, since its key points are list items too.
    await page.getByRole("region", { name: "Questions" }).locator("li button").first().click();
    const questions = page.getByRole("region", { name: "Questions" }).getByRole("listitem");
    const countBefore = await questions.count();
    await page
      .getByRole("button", { name: /remove question/i })
      .first()
      .click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/stops coming up/i)).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(questions).toHaveCount(countBefore);
  });
});

test.describe("the map", () => {
  test("draws subjects, says where reading meets questions, and focuses one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/map");

    await expect(page.getByRole("heading", { name: "Map" })).toBeVisible();
    await expect(page.getByText(/questions and \d+ links across \d+ subjects/)).toBeVisible();

    const bridges = page.getByRole("region", { name: "Bridges" }).getByRole("button");
    await expect(bridges.first()).toBeVisible();
    await bridges.first().click();
    await expect(page.getByRole("button", { name: /show everything/ })).toBeVisible();

    // Every dot is a real link to the thing it stands for.
    await expect(
      page.locator('section[aria-label^="Map"] a[href^="/links/"]').first(),
    ).toBeAttached();
  });
});
