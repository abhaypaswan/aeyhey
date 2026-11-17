// SPDX-License-Identifier: AGPL-3.0-only
// /connect: where a phone app signs in.
//
// The app opens this page in the system browser with a PKCE challenge and the place to
// send the answer. The person signs in here the normal way, sees which app is asking, and
// taps Allow. Then the browser goes back to the app with a one-time code, which the app
// trades for its own token at POST /api/auth/token.
//
// Everything is checked again when Allow is tapped. The checks here only decide whether
// to show the page or explain what is wrong.

import { redirect } from "next/navigation";
import { extensions } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { getRuntime } from "../../runtime";
import { Card, Notice, Page, PageHeader } from "../../components/ui";
import { ConnectApproval } from "../../components/connect-approval";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const PKCE = /^[A-Za-z0-9\-._~]{43,128}$/;

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const redirectUri = one(params, "redirect_uri") ?? "";
  const codeChallenge = one(params, "code_challenge") ?? "";
  const method = one(params, "code_challenge_method") ?? "";
  const deviceName = (one(params, "device_name") ?? "").trim().slice(0, 80) || "Aeyhey app";
  const state = one(params, "state");

  const { env, registry } = await getRuntime();
  const allowed = extensions.parseRedirectList(env.API_REDIRECT_URIS);

  const problem = !extensions.redirectAllowed(redirectUri, allowed)
    ? "This app is not allowed to sign in to this instance."
    : method !== "S256" || !PKCE.test(codeChallenge)
      ? "The app sent a sign-in request this instance cannot use. Update the app and try again."
      : null;

  if (problem) {
    return (
      <Page width="narrow">
        <PageHeader title="Connect an app" />
        <Notice tone="error">{problem}</Notice>
      </Page>
    );
  }

  const page = await pageState();
  if (page.state === "needs_setup") redirect("/setup");
  if (page.state === "needs_login") {
    const back = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") back.set(key, value);
    }
    const signIn = registry.auth.routes?.signIn ?? "/login";
    redirect(`${signIn}?next=${encodeURIComponent(`/connect?${back.toString()}`)}`);
  }

  const { user } = page.context;

  return (
    <Page width="narrow">
      <PageHeader
        title="Connect an app"
        subtitle="An app on your phone wants to use your Aeyhey account."
      />
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold">{deviceName}</p>
          <p className="text-muted-foreground text-sm">
            {user.email
              ? `It will be signed in as ${user.email}.`
              : `It will be signed in as ${user.displayName}.`}{" "}
            It can see and change your links, decks and settings, and send you reminders. You can
            sign it out at any time from Settings.
          </p>
        </div>
        <ConnectApproval
          request={{
            redirectUri,
            codeChallenge,
            codeChallengeMethod: "S256",
            deviceName,
            ...(state !== undefined ? { state } : {}),
          }}
        />
      </Card>
      <p className="text-muted-foreground text-xs">
        Only allow this if you just started signing in from the app yourself.
      </p>
    </Page>
  );
}
