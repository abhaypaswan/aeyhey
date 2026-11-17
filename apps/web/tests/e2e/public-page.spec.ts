// SPDX-License-Identifier: AGPL-3.0-only
// The "What I learned" public page (PRD 28): set up from the app, a takeaway shared from a
// read link, and what a visitor sees at /u/<handle> and in the feed.
//
// Everything this changes is put back at the end, because the e2e run shares one
// database across projects.

import { expect, test, type APIRequestContext } from "@playwright/test";

const HANDLE = "e2e-reader";

/**
 * A read link to share. Earlier tests in the run may have used the demo's read links up,
 * so when there is none this marks one read and says what to put back afterwards.
 */
async function aReadLink(
  request: APIRequestContext,
): Promise<{ id: string; restoreStatus: string | null }> {
  const read = (await (await request.get("/api/links?status=read&limit=1")).json()) as {
    items: { id: string }[];
  };
  if (read.items[0]) return { id: read.items[0].id, restoreStatus: null };

  const any = (await (await request.get("/api/links?limit=1")).json()) as {
    items: { id: string; status: string }[];
  };
  const link = any.items[0];
  if (!link) throw new Error("The demo data has no links at all.");
  await request.patch(`/api/links/${link.id}`, { data: { status: "read" } });
  return { id: link.id, restoreStatus: link.status };
}

test("a takeaway shared in the app shows on the public page and in its feed", async ({
  page,
  request,
}) => {
  const link = await aReadLink(request);

  // The page starts hidden or missing: a visitor sees a 404 either way.
  await request.patch("/api/public-page", { data: { handle: HANDLE, enabled: false } });
  expect((await request.get(`/u/${HANDLE}`)).status()).toBe(404);

  await request.patch("/api/public-page", { data: { enabled: true } });

  // Share it from the link page, the way a person would.
  await page.goto(`/links/${link.id}`);
  const box = page.getByRole("textbox", { name: "What did you learn?" });
  await box.fill("Write down the one thing worth keeping.");
  await page.getByRole("button", { name: "Put it on my page" }).click();
  await expect(page.getByText("On your page.", { exact: true })).toBeVisible();

  await page.goto(`/u/${HANDLE}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Write down the one thing worth keeping.")).toBeVisible();
  // The visitor's page carries none of the app around it.
  await expect(page.getByRole("navigation", { name: /main/i })).toHaveCount(0);

  const feed = await request.get(`/u/${HANDLE}/rss.xml`);
  expect(feed.headers()["content-type"]).toContain("application/rss+xml");
  expect(await feed.text()).toContain("Write down the one thing worth keeping.");

  // Put everything back for the next project.
  await request.delete(`/api/links/${link.id}/share`);
  if (link.restoreStatus) {
    await request.patch(`/api/links/${link.id}`, { data: { status: link.restoreStatus } });
  }
  await request.patch("/api/public-page", { data: { enabled: false } });
  expect((await request.get(`/u/${HANDLE}`)).status()).toBe(404);
});

test("the settings screen shows the page and its address", async ({ page, request }) => {
  await request.patch("/api/public-page", { data: { handle: HANDLE } });
  await page.goto("/your-page");
  await expect(page.getByRole("heading", { name: "Your page", level: 1 })).toBeVisible();
  await expect(page.getByText(`/u/${HANDLE}`).first()).toBeVisible();
  await expect(page.getByRole("switch", { name: "Public" })).toBeVisible();
});
