// SPDX-License-Identifier: AGPL-3.0-only
// One link, set like a clipping of the article you meant to read, as the phone app has
// it. The title is large, the summary is one short paragraph, and everything else is
// quiet. The theme colour is kept for "Read it"; amber marks only the guess at why it
// was saved. A wide screen keeps the actions in a column beside the article, and below
// it shows the text Aeyhey extracted, which the phone leaves to the browser.

import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { repos } from "@aeyhey/core";
import { pageState } from "../../../lib/server";
import { TakeawayEditor } from "../../../components/takeaway-editor";
import { LinkActions, LinkDetails, LinkMoreMenu } from "../../../components/link-detail";
import { getRuntime } from "../../../runtime";
import { hostOf, linkTitle, relativeDate } from "../../../lib/format";
import { strong, type Hue } from "../../../lib/hue";
import { cx } from "../../../components/ui";

export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; hue: Hue | null }> = {
  snoozed: { label: "later", hue: "violet" },
  read: { label: "read", hue: "green" },
  dropped: { label: "dropped", hue: null },
  expiring: { label: "last chance", hue: "amber" },
  expired: { label: "expired", hue: "red" },
};

export default async function LinkPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { id } = await params;
  const { scope } = state.context;

  const link = await repos.findLinkById(scope, id);
  if (!link) notFound();

  const tags = (await repos.tagsForItems(scope, "link", [id])).get(id) ?? [];

  // Only a read link can go on the public page.
  let publicPage: { state: "none" } | { state: "off" } | { state: "on"; url: string } = {
    state: "none",
  };
  if (link.status === "read") {
    const profile = await repos.findPublicProfile(scope);
    const { env } = await getRuntime();
    if (profile) {
      publicPage = profile.enabled
        ? { state: "on", url: `${env.PUBLIC_URL.replace(/\/+$/, "")}/u/${profile.handle}` }
        : { state: "off" };
    }
  }
  const draft = link.summaryLines?.[link.summaryLines.length - 1]?.trim() ?? "";

  const status = STATE[link.status];
  const meta = [
    link.siteName ?? hostOf(link.url),
    link.contentType && link.contentType !== "article" ? link.contentType : null,
    link.readMinutes ? `${link.readMinutes} min read` : null,
    relativeDate(link.savedAt.toISOString()),
  ]
    .filter(Boolean)
    .join(" · ");

  const summary = link.summaryLines
    ?.map((line) => (/[.!?]$/.test(line.trim()) ? line.trim() : `${line.trim()}.`))
    .join(" ");
  const pending = link.aiStatus === "pending" || link.extractStatus === "pending";

  const facts = {
    id: link.id,
    url: link.url,
    status: link.status,
    readMinutes: link.readMinutes ?? null,
    note: link.userNote ?? null,
    tags,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-[22px] pb-32 pt-2 sm:px-6 lg:px-8 lg:pb-20 lg:pt-6">
      <div className="flex items-center justify-between">
        <a
          href="/inbox"
          className="text-foreground hover:bg-quiet -ml-2 flex items-center gap-1.5 rounded-full py-2 pl-2 pr-3 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={20} aria-hidden="true" />
          <span className="hidden lg:inline">Inbox</span>
        </a>
        <LinkMoreMenu link={facts} />
      </div>

      <div className="mt-2 grid gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="link-rise flex min-w-0 flex-col">
          <p className="text-muted-foreground text-[13px] leading-[1.4]">
            {meta}
            {status ? (
              <>
                {" · "}
                <span
                  className="font-medium"
                  style={{ color: status.hue ? strong(status.hue) : undefined }}
                >
                  {status.label}
                </span>
              </>
            ) : null}
          </p>
          {/* An address has no spaces, so it may break anywhere; until the real title is
              known it is shown smaller, as what it is. */}
          <h1
            className={cx(
              "font-display mt-3 font-[560] leading-[1.14] tracking-[-0.014em] [overflow-wrap:anywhere]",
              link.title ? "text-[29px] lg:text-[42px]" : "text-[24px] lg:text-[30px]",
            )}
          >
            {linkTitle(link.title, link.url)}
          </h1>

          {pending ? (
            <p className="text-muted-foreground mt-4 flex items-center gap-2.5 text-sm">
              <span className="border-muted-foreground size-[13px] animate-spin rounded-full border-[1.6px] border-t-transparent" />
              Still reading and summarising this one.
            </p>
          ) : null}

          {summary ? (
            <>
              <hr className="border-border mb-5 mt-[22px] border-t-[0.5px]" />
              <p className="text-[17.5px] leading-[1.55] lg:text-lg">{summary}</p>
            </>
          ) : pending ? null : (
            <p className="text-muted-foreground mt-5 text-[15px]">
              No summary for this one.
              {link.aiStatus === "skipped" ? " There was nothing readable to summarise." : ""}
            </p>
          )}

          {link.whySaved ? (
            <div className="mt-[22px] flex gap-3.5">
              <span
                aria-hidden="true"
                className="w-0.5 shrink-0 rounded-sm"
                style={{ background: strong("amber") }}
              />
              <div className="flex flex-col gap-[3px]">
                <span className="text-[12.5px] font-semibold" style={{ color: strong("amber") }}>
                  Why you probably saved it
                </span>
                <span className="text-[14.5px] leading-[1.45]">{link.whySaved}</span>
              </div>
            </div>
          ) : null}

          {link.status === "read" ? (
            <div className="mt-[26px]">
              <TakeawayEditor
                linkId={link.id}
                current={link.sharedAt && link.publicTakeaway ? link.publicTakeaway : null}
                draft={draft}
                page={publicPage}
              />
            </div>
          ) : null}

          <div className="mt-[26px]">
            <LinkDetails link={facts} />
          </div>

          {link.extractedText ? (
            <details className="group mt-8">
              <summary className="text-primary cursor-pointer list-none text-sm font-semibold">
                <span className="group-open:hidden">Show the text Aeyhey kept</span>
                <span className="hidden group-open:inline">Hide the text</span>
              </summary>
              <div className="text-muted-foreground mt-3 text-xs">
                The original is always the better read, but this works offline.
              </div>
              <div className="mt-4 whitespace-pre-wrap text-base leading-relaxed">
                {link.extractedText}
              </div>
            </details>
          ) : null}
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <LinkActions link={facts} />
        </aside>
      </div>
    </main>
  );
}
