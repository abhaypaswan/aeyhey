// SPDX-License-Identifier: AGPL-3.0-only
// Server-side helpers for the pages.
//
// Pages read the database through core's repositories directly rather than fetching their
// own API over HTTP. One round trip instead of two, and a server component has the user's
// cookies anyway.

import { cache } from "react";
import { headers as nextHeaders } from "next/headers";
import { extensions, repos } from "@aeyhey/core";
import { getRuntime } from "../runtime";

export interface PageContext {
  scope: repos.Scope;
  user: extensions.AuthUser;
}

/** Reconstructs a Request from the incoming headers, which is what AuthProvider takes. */
async function requestFromHeaders(): Promise<Request> {
  const incoming = await nextHeaders();
  const forwarded = new Headers();
  for (const [key, value] of incoming.entries()) forwarded.set(key, value);
  return new Request("http://localhost/", { headers: forwarded });
}

export type PageState =
  { state: "needs_setup" } | { state: "needs_login" } | { state: "ready"; context: PageContext };

/**
 * Cached for the length of one request: the app shell in the root layout and the page it
 * wraps both ask, and the second answer should not cost a second round of queries.
 */
export const pageState = cache(async (): Promise<PageState> => {
  const { handle, registry } = await getRuntime();

  // First-run setup creates the single owner. A multi-user instance has sign-up instead,
  // so it never sends anyone there.
  if (!registry.config.flags.multiUser && !(await extensions.ownerExists(handle))) {
    return { state: "needs_setup" };
  }

  const user = await registry.auth.getUser(await requestFromHeaders());
  if (!user) return { state: "needs_login" };

  return { state: "ready", context: { scope: repos.scopeFor(handle, user.id), user } };
});

export async function flags(): Promise<extensions.FeatureFlags> {
  return (await getRuntime()).registry.config.flags;
}

/**
 * The page where the account is deleted, only where the sign-in provider can delete one
 * (hosted). Local sign-in names an account route too, but has no account to delete.
 */
export async function accountPage(): Promise<string | null> {
  const { auth } = (await getRuntime()).registry;
  return auth.deleteAccount ? (auth.routes?.account ?? null) : null;
}

/** Links plugins add to the sidebar. Empty in the community build. */
export async function pluginNav(): Promise<{ href: string; label: string; icon?: string }[]> {
  const { registry } = await getRuntime();
  return registry.nav.map((item) => ({
    href: item.href,
    label: item.label,
    ...(item.icon ? { icon: item.icon } : {}),
  }));
}
