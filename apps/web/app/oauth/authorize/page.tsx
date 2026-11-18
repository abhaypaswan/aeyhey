// SPDX-License-Identifier: AGPL-3.0-only
// /oauth/authorize: a coding agent asks to connect to Aeyhey.
//
// The agent (Claude Code, Codex, Cursor and so on) opens this page in the browser. The
// person signs in if they need to, sees which agent is asking, what it will be able to
// do and where they will be sent back to, and taps Allow. A request that is wrong is
// explained here and never redirected, since the redirect is what cannot be trusted.

import { redirect } from "next/navigation";
import { env as loadEnv } from "@aeyhey/core";
import { describeRedirect, readAuthorizeRequest } from "@aeyhey/core/api";
import { pageState } from "../../../lib/server";
import { getRuntime } from "../../../runtime";
import { Card, Notice, Page, PageHeader } from "../../../components/ui";
import { OauthApproval } from "../../../components/oauth-approval";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function toParams(params: SearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one !== undefined) out.set(key, one);
  }
  return out;
}

export default async function OauthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = toParams(await searchParams);
  const { appSecret, registry } = await getRuntime();
  const read = readAuthorizeRequest(params, appSecret);

  if (!read.ok) {
    return (
      <Page width="narrow">
        <PageHeader title="Connect a coding agent" />
        <Notice tone="error">{read.problem}</Notice>
      </Page>
    );
  }

  const page = await pageState();
  if (page.state === "needs_setup") redirect("/setup");
  if (page.state === "needs_login") {
    const signIn = registry.auth.routes?.signIn ?? "/login";
    redirect(`${signIn}?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);
  }

  const { request } = read;
  const { user } = page.context;
  const back = describeRedirect(request.redirectUri);
  const cancel = new URL(request.redirectUri);
  cancel.searchParams.set("error", "access_denied");
  if (request.state) cancel.searchParams.set("state", request.state);
  cancel.searchParams.set("iss", loadEnv().PUBLIC_URL.replace(/\/+$/, ""));

  return (
    <Page width="narrow">
      <PageHeader
        title="Connect a coding agent"
        subtitle="A coding agent wants to work with your Aeyhey."
      />
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="font-display text-xl font-[640]">{request.client.name}</p>
          <p className="text-muted-foreground text-[15px] leading-[1.5]">
            {user.email ? `As ${user.email}, it` : "It"} will be able to save links to your inbox
            and note what you finish, for your daily summary. It cannot read your links, decks or
            anything else. You can sign it out at any time from Settings, Data, Signed-in apps.
          </p>
          <p className="text-[14.5px]">
            After you allow it, you go back to <span className="font-semibold">{back.where}</span>.
          </p>
        </div>
        <OauthApproval
          agentName={request.client.name}
          cancelHref={cancel.toString()}
          request={{
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            codeChallenge: request.codeChallenge,
            ...(request.state ? { state: request.state } : {}),
          }}
        />
      </Card>
      <p className="text-muted-foreground text-xs">
        {back.local
          ? "Only allow this if you just started connecting an agent on this computer yourself. Anything on this computer can ask under any name."
          : "Only allow this if you just started connecting this agent yourself."}
      </p>
    </Page>
  );
}
