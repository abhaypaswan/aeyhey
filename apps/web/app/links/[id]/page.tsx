// SPDX-License-Identifier: AGPL-3.0-only
// Link detail and reader view (PRD 12.1 screen 5, 8.1 FR-LINK-9).

import { notFound, redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../../lib/server";
import {
  Card,
  CardTitle,
  Columns,
  LinkButton,
  Page,
  PageHeader,
  StatusPill,
  Tag,
} from "../../../components/ui";
import { ExternalLink } from "../../../components/icons";
import { TakeawayEditor } from "../../../components/takeaway-editor";
import { getRuntime } from "../../../runtime";
import { hostOf, relativeDate, tagLabel } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function LinkPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { id } = await params;
  const { scope } = state.context;

  const link = await repos.findLinkById(scope, id);
  if (!link) notFound();

  const tags = (await repos.tagsForItems(scope, "link", [id])).get(id) ?? [];

  // Only a read link can go on the public page (PRD 28).
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

  const meta = [
    link.siteName ?? hostOf(link.url),
    link.author,
    link.readMinutes ? `${link.readMinutes} min read` : null,
    relativeDate(link.savedAt.toISOString()),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Page>
      <PageHeader
        back={{ href: "/inbox", label: "Inbox" }}
        title={link.title ?? link.url}
        subtitle={meta}
        action={
          <>
            <StatusPill status={link.status} />
            <LinkButton href={link.url} tone="primary" icon={ExternalLink} external>
              Open the original
            </LinkButton>
          </>
        }
      />

      <Columns
        asideFirstOnPhone
        asideWidth="lg"
        aside={
          <>
            {link.status === "read" ? (
              <TakeawayEditor
                linkId={link.id}
                current={link.sharedAt && link.publicTakeaway ? link.publicTakeaway : null}
                draft={draft}
                page={publicPage}
              />
            ) : null}

            <Card className="flex flex-col gap-3">
              <CardTitle>Summary</CardTitle>
              {link.summaryLines ? (
                <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed">
                  {link.summaryLines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : link.aiStatus === "pending" ? (
                <p className="text-muted-foreground text-sm italic">
                  The summary is still being written.
                </p>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  No summary for this one.
                  {link.aiStatus === "skipped" ? " There was nothing readable to summarize." : ""}
                </p>
              )}
            </Card>

            {link.whySaved || link.userNote ? (
              <Card className="flex flex-col gap-3">
                {link.whySaved ? (
                  <div className="flex flex-col gap-1">
                    <CardTitle>Why you probably saved this</CardTitle>
                    <p className="text-muted-foreground text-sm leading-relaxed">{link.whySaved}</p>
                  </div>
                ) : null}
                {link.userNote ? (
                  <div className="flex flex-col gap-1">
                    <CardTitle>Your note</CardTitle>
                    <p className="text-sm leading-relaxed">{link.userNote}</p>
                  </div>
                ) : null}
              </Card>
            ) : null}

            <Card className="flex flex-col gap-3">
              <CardTitle>Tags</CardTitle>
              <div id="tags" className="flex flex-wrap gap-1.5">
                {tags.length > 0 ? (
                  tags.map((tag) => <Tag key={tag}>{tagLabel(tag)}</Tag>)
                ) : (
                  <span className="text-muted-foreground text-xs">No tags.</span>
                )}
              </div>
            </Card>
          </>
        }
      >
        {link.extractedText ? (
          <Card padding="lg" className="flex flex-col gap-3">
            <CardTitle hint="The text Aeyhey extracted. The original is always the better read, but this works offline.">
              Reader view
            </CardTitle>
            <article className="max-w-[72ch] whitespace-pre-wrap text-base leading-relaxed">
              {link.extractedText}
            </article>
          </Card>
        ) : (
          <Card>
            <p className="text-muted-foreground text-sm">
              No reader view for this one.
              {link.extractStatus === "failed"
                ? " The page could not be fetched, so only the link was kept."
                : ""}
            </p>
          </Card>
        )}
      </Columns>
    </Page>
  );
}
