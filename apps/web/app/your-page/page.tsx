// SPDX-License-Identifier: AGPL-3.0-only
// Your "What I learned" page, from the inside (PRD 28). Before it exists, set it up.
// After, it shows the page as a visitor reads it, with the public switch above it. Lines
// from coding sessions show on the page by themselves, under the day they happened.
// ?edit=1 opens the settings: the page's name and words, the work side and what shows.

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { getRuntime } from "../../runtime";
import { PublicPageSettings } from "../../components/public-page-settings";
import { OwnerBar } from "../../components/your-page-owner";
import { PublicPageView } from "../u/[handle]/view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function YourPage({ searchParams }: Props) {
  const editing = (await searchParams)["edit"] !== undefined;
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope, user } = state.context;
  const { env } = await getRuntime();
  const prefix = `${env.PUBLIC_URL.replace(/\/+$/, "")}/u/`;

  const profile = await repos.findPublicProfile(scope);

  if (profile && !editing) {
    const page = await repos.publicPageByHandle(scope.handle, profile.handle, {
      includeHidden: true,
    });
    if (page) {
      const url = `${prefix}${page.handle}`;
      return (
        <PublicPageView
          page={page}
          pageUrl={url}
          owner
          top={<OwnerBar url={url} handle={page.handle} enabled={profile.enabled} />}
        />
      );
    }
  }

  const links = profile ? await repos.listSharedLinks(scope, { limit: 100 }) : { items: [] };

  // A suggestion only before the first save, built the same way the API builds one.
  const base = user.displayName
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suggested =
    !profile &&
    base &&
    base !== "you" &&
    !repos.handleProblem(base) &&
    (await repos.handleAvailable(scope, base))
      ? base
      : "";

  return (
    <PublicPageSettings
      prefix={prefix}
      displayName={user.displayName === "You" ? null : user.displayName}
      suggested={suggested}
      initial={
        profile
          ? {
              handle: profile.handle,
              title: profile.title,
              bio: profile.bio,
              enabled: profile.enabled,
              indexable: profile.indexable,
              showFooter: profile.showFooter,
              showStats: profile.showStats,
              buildingVisibility: profile.buildingVisibility,
              showAgentModels: profile.showAgentModels,
            }
          : null
      }
      work={
        profile
          ? {
              headline: profile.headline,
              location: profile.location,
              links: profile.links,
              skills: profile.skills,
              interests: profile.interests,
              experience: profile.experience,
              projects: profile.projects,
            }
          : null
      }
      links={links.items.map((link) => ({
        id: link.id,
        url: link.url,
        title: link.title,
        site: link.siteName,
        takeaway: link.takeaway,
        sharedAt: link.sharedAt.toISOString(),
      }))}
    />
  );
}
