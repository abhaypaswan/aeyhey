// SPDX-License-Identifier: AGPL-3.0-only
// The API handlers (PRD 11).
//
// These are plain functions over a context, not Next.js route files, for two reasons: they
// can be tested without a server, and the hosted app can mount the same handlers under its
// own routes without copying them.
//
// apps/web/app/api/**/route.ts files are thin wrappers that call these.

import type { DbHandle } from "../db/client";
import type { Env } from "../env";
import type { Registry } from "../extensions/registry";
import type { AiCallDeps } from "../ai/call";
import { AiLimiter } from "../ai/limiter";
import { scopeFor } from "../repos/context";
import { createAgentApi } from "./agent-handlers";
import { applyCardAction, CardActionSchema, undoCardAction } from "../sessions/actions";
import { answerQuestion, dontKnow, revealAnswer } from "../sessions/answer";
import { getOrBuildSession, summarizeSession } from "../sessions/service";
import {
  findLinkById,
  findLinkWithLifeLeft,
  linkCounts,
  listLinks,
  saveLinks,
  updateLink,
} from "../repos/links";
import {
  acceptQuestions,
  addManualQuestion,
  createDocumentSource,
  createResumeSource,
  createTopicSource,
  deleteDeck,
  deleteQuestion,
  deleteResumeData,
  findDeck,
  findQuestion,
  deckTopics,
  listDecks,
  renameDeck,
  setDeckPaused,
  setTopicDetails,
  listQuestions,
  lastAnswers,
  questionProgress,
  updateQuestion,
} from "../repos/questions";
import { addItemTags, listTags, removeItemTag, setItemTags } from "../repos/tags";
import {
  loadAvatar,
  ownAvatarUrl,
  parseAvatar,
  removeAvatar,
  saveAvatar,
  setDisplayName,
} from "../repos/profile";
import {
  countSharedLinks,
  findPublicProfile,
  handleAvailable,
  handleProblem,
  listSharedLinks,
  movedHandle,
  ownerPagePreview,
  findEnabledPageOwner,
  loadPublicDays,
  normalizeHandle,
  publicPageByHandle,
  resumeDraft,
  savePublicProfile,
  shareLink,
  unshareLink,
} from "../repos/public-page";
import {
  loadSettings,
  pauseFor,
  pauseIndefinitely,
  publicSettings,
  resumeNow,
  toCadenceSettings,
  updateSettings,
} from "../repos/settings";
import { describeNextSession, isPaused } from "../scheduler/cadence";
import { findCardForItem, saveCardAfterAction, updateCardStatus } from "../repos/cards";
import { applyLinkAction, snapshot } from "../scheduler/scheduler";
import { enqueue, findJob } from "../jobs/queue";
import {
  parseDocumentFile,
  parseDocumentText,
  parseResumeText,
  stripPii,
  type ParsedResume,
} from "../questions/resume-parse";
import { callAi } from "../ai/call";
import type { DocumentIntentOutput } from "../ai/contracts/index";
import {
  buildDocumentIntentPrompt,
  DOCUMENT_INTENT_CHARS,
  DOCUMENT_INTENT_SYSTEM,
} from "../ai/prompts/document-intent";
import { buildChannels } from "../notify/channels";
import { deletePushSubscription, savePushSubscription } from "../notify/push";
import { registerDevice, unregisterDevice } from "../notify/devices";
import { loadStats } from "../repos/stats";
import { loadToday } from "../sessions/today";
import {
  apiTokenIdFor,
  createAuthCode,
  exchangeAuthCode,
  InvalidRedirectError,
  listApiTokens,
  parseRedirectList,
  readBearer,
  redirectAllowed,
  revokeApiToken,
} from "../extensions/api-tokens";
import { requestEmailVerification } from "../notify/email/index";
import { createLinkCode } from "../notify/telegram/index";
import { testConnection } from "../ai/providers";
import { encryptSecret } from "../security/crypto";
import { maskKey } from "../security/redact";
import { lockedSettingKeys } from "../env";
import { newId } from "../ids";
import { fail, json, route, parseListQuery, type RouteContext } from "./respond";
import * as schemas from "./schemas";
import { deleteAllData } from "./data";
import { createLogger } from "../logger";

const log = createLogger("api");

export interface ApiDeps {
  handle: DbHandle;
  env: Env;
  registry: Registry;
  appSecret: string;
}

/** Built once per process, so the AI rate limiter is shared across requests. */
function aiDeps(deps: ApiDeps): AiCallDeps {
  return {
    keys: deps.registry.aiKeys,
    gate: deps.registry.usageGate,
    sink: deps.registry.usageSink,
    limiter: new AiLimiter({
      maxConcurrency: deps.env.AI_MAX_CONCURRENCY,
      requestsPerMinute: deps.env.AI_RPM,
    }),
  };
}

export function createApi(deps: ApiDeps) {
  const { handle, env, registry } = deps;
  const base = { auth: registry.auth, publicUrl: env.PUBLIC_URL };
  const ai = aiDeps(deps);
  const redirectUris = parseRedirectList(env.API_REDIRECT_URIS);
  const scope = (ctx: RouteContext<unknown>) => scopeFor(handle, ctx.user.id);

  return {
    ...createAgentApi({ handle, base, ai }),

    // ---------------------------------------------------------------- links

    addLinks: route({ ...base, schema: schemas.AddLinksSchema }, async (ctx) => {
      const result = await saveLinks(scope(ctx), {
        text: ctx.body.text,
        note: ctx.body.note ?? null,
        source: ctx.body.source ?? "paste",
      });

      // One extract job per new link. The enrich job is queued by the extract handler,
      // so a slow fetch never blocks a summary that is ready.
      for (const link of result.created) {
        await enqueue(handle, {
          type: "extract_link",
          userId: ctx.user.id,
          payload: { linkId: link.id },
          dedupeKey: `extract:${link.id}`,
        });
      }

      return json({
        created: result.created.length,
        duplicates: result.duplicates.length,
        skipped: result.skipped.length,
        links: result.created,
      });
    }),

    listLinks: route(base, async (ctx) => {
      const { limit, cursor, q } = parseListQuery(ctx.query);
      const status = ctx.query.get("status");

      const page = await listLinks(scope(ctx), {
        ...(status ? { status: status as never } : {}),
        ...(ctx.query.get("tag") ? { tag: ctx.query.get("tag")! } : {}),
        ...(ctx.query.get("type") ? { contentType: ctx.query.get("type")! } : {}),
        ...(q ? { q } : {}),
        ...(ctx.query.get("sort") ? { sort: ctx.query.get("sort") as never } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
      });

      return json(page);
    }),

    getLink: (linkId: string) =>
      route(base, async (ctx) => {
        const link = await findLinkWithLifeLeft(scope(ctx), linkId);
        if (!link) return fail(404, "not_found", "That link is not in your collection.");
        return json({ link });
      }),

    updateLink: (linkId: string) =>
      route({ ...base, schema: schemas.UpdateLinkSchema }, async (ctx) => {
        const s = scope(ctx);
        const link = await findLinkById(s, linkId);
        if (!link) return fail(404, "not_found", "That link is not in your collection.");

        await updateLink(s, linkId, {
          ...(ctx.body.title !== undefined ? { title: ctx.body.title } : {}),
          ...(ctx.body.note !== undefined ? { userNote: ctx.body.note } : {}),
          ...(ctx.body.status !== undefined ? { status: ctx.body.status } : {}),
        });

        if (ctx.body.tags) {
          await setItemTags(s, { type: "link", id: linkId }, ctx.body.tags);
        }

        // The card mirrors the link's status, or the scheduler and the inbox disagree.
        if (ctx.body.status) {
          const card = await findCardForItem(s, { type: "link", id: linkId });
          if (card) await updateCardStatus(s, card.id, ctx.body.status);
        }

        return json({ ok: true });
      }),

    reprocessLink: (linkId: string) =>
      route(base, async (ctx) => {
        const link = await findLinkById(scope(ctx), linkId);
        if (!link) return fail(404, "not_found", "That link is not in your collection.");

        const jobId = await enqueue(handle, {
          type: "extract_link",
          userId: ctx.user.id,
          payload: { linkId },
          dedupeKey: `extract:${linkId}`,
        });

        // FSRS state is deliberately untouched: a refreshed summary is not a review.
        return json({ jobId });
      }),

    bulkLinks: route({ ...base, schema: schemas.BulkLinkSchema }, async (ctx) => {
      const s = scope(ctx);
      let changed = 0;

      for (const id of ctx.body.ids) {
        const link = await findLinkById(s, id);
        if (!link) continue;

        switch (ctx.body.action) {
          case "drop":
            await updateLink(s, id, { status: "dropped" });
            break;
          case "restore": {
            await updateLink(s, id, { status: "unread", snoozeCount: 0, rescued: false });

            // The card has to be reset too, not just the link row. A link snoozed four
            // times is scheduled months out, so setting its status back to unread without
            // touching the schedule makes Restore look like it did nothing: the link
            // never comes back. forget() is the same path the single-card restore takes
            // (PRD 9.4 rule 4).
            const card = await findCardForItem(s, { type: "link", id });
            if (card) {
              const scheduled = applyLinkAction({ card, action: { kind: "restore" } });
              await saveCardAfterAction(s, {
                card: scheduled.card,
                action: "restore",
                before: snapshot(card),
                channel: "web",
                ...(scheduled.fsrsLog
                  ? { fsrsLog: scheduled.fsrsLog as unknown as Record<string, unknown> }
                  : {}),
              });
            }
            break;
          }
          case "mark_read":
            await updateLink(s, id, { status: "read", readAt: new Date() });
            break;
          case "add_tag":
            if (ctx.body.tag) await addItemTags(s, { type: "link", id }, [ctx.body.tag]);
            break;
          case "remove_tag":
            if (ctx.body.tag) await removeItemTag(s, { type: "link", id }, ctx.body.tag);
            break;
        }

        // Restore already wrote the card above, schedule included.
        if (ctx.body.action === "drop" || ctx.body.action === "mark_read") {
          const card = await findCardForItem(s, { type: "link", id });
          if (card) {
            await updateCardStatus(s, card.id, ctx.body.action === "drop" ? "dropped" : "read");
          }
        }
        changed += 1;
      }

      return json({ changed });
    }),

    linkCounts: route(base, async (ctx) => json({ counts: await linkCounts(scope(ctx)) })),

    listTags: route(base, async (ctx) => json({ tags: await listTags(scope(ctx)) })),

    // ---------------------------------------------------------------- questions

    createTopicSource: route({ ...base, schema: schemas.TopicSourceSchema }, async (ctx) => {
      const sourceId = await createTopicSource(scope(ctx), {
        topics: ctx.body.topics,
        level: ctx.body.level,
        style: ctx.body.style,
        countPerTopic: ctx.body.countPerTopic,
        extraContext: ctx.body.extraContext ?? null,
      });

      const jobId = await enqueue(handle, {
        type: "generate_questions",
        userId: ctx.user.id,
        payload: { sourceId },
        dedupeKey: `generate:${sourceId}`,
      });

      return json({ sourceId, jobId }, { status: 201 });
    }),

    createResumeSource: route({ ...base, schema: schemas.ResumeTextSchema }, async (ctx) => {
      const s = scope(ctx);
      const settings = await loadSettings(s);

      // The PII pass runs before anything is stored, not just before the AI call, so a
      // database dump has no contact details in it either.
      const parsed = parseResumeText(ctx.body.text, { stripPii: settings.stripPii });

      const sourceId = await createResumeSource(s, {
        resumeText: parsed.text,
        targetRole: ctx.body.targetRole ?? null,
        seniority: ctx.body.seniority ?? null,
        jobDescription: ctx.body.jobDescription ?? null,
        ...(ctx.body.focus ? { focus: ctx.body.focus } : {}),
      });

      return json(
        {
          sourceId,
          extractedText: parsed.text,
          redactions: parsed.redactions,
          suspicious: parsed.suspicious,
          note: parsed.note ?? null,
        },
        { status: 201 },
      );
    }),

    createDocumentSource: route({ ...base, schema: schemas.DocumentSourceSchema }, async (ctx) => {
      const s = scope(ctx);
      const body = ctx.body;

      // Read it as plain text first. Resume-only cleanup waits until we know it is one.
      let parsed: ParsedResume;
      if (body.file) {
        const bytes = new Uint8Array(Buffer.from(body.file.base64, "base64"));
        parsed = await parseDocumentFile({
          bytes,
          filename: body.file.name,
          ...(body.file.contentType ? { declaredType: body.file.contentType } : {}),
        });
      } else {
        parsed = parseDocumentText(body.text ?? "");
      }

      // Decide what to make from it. An explicit study or resume needs no AI call; auto and
      // topics ask the model, which also pulls the topics out of a syllabus or a job ad.
      let intent: "study" | "resume" | "topics" | "unclear" =
        body.purpose === "auto" ? "unclear" : body.purpose;
      let detected: DocumentIntentOutput | null = null;
      if (body.purpose === "auto" || body.purpose === "topics") {
        const result = await callAi(ai, {
          contract: "document_intent",
          userId: ctx.user.id,
          system: DOCUMENT_INTENT_SYSTEM,
          prompt: buildDocumentIntentPrompt({
            // What a document is shows without anyone's email or phone number in it.
            text: stripPii(parsed.text.slice(0, DOCUMENT_INTENT_CHARS * 2)).text,
            fileName: body.file?.name ?? null,
            request: body.instruction ?? null,
          }),
        });
        detected = result.object;
        if (body.purpose === "auto") intent = detected.intent;
        // Topics with nothing to show for it is not something to build a deck on.
        if (intent === "topics" && detected.topics.length === 0) {
          if (body.purpose === "topics") {
            return fail(422, "no_topics", "I could not find a list of topics in that document.");
          }
          intent = "unclear";
        }
      }

      // "Chapter 4.pdf" reads better as a deck name than "Your document".
      const fromFile = body.file?.name
        .replace(/\.[a-z0-9]{1,5}$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      const title =
        body.title?.trim() ||
        (intent === "resume" ? "Your resume" : null) ||
        detected?.title ||
        fromFile ||
        "Your document";

      const answer = (sourceId: string | null, extra: Record<string, unknown> = {}) =>
        json(
          {
            sourceId,
            title,
            // purpose is kept for older clients; intent is the decision.
            purpose: intent,
            intent,
            documentType: detected?.document_type ?? null,
            reason: detected?.reason ?? null,
            // What the questions will be kept inside, so the person can see it.
            scope: intent === "resume" ? null : detected?.scope || null,
            topics: intent === "topics" ? (detected?.topics ?? []) : [],
            kind: parsed.kind,
            characters: parsed.text.length,
            // Enough to show what was read and let the person confirm it.
            preview: parsed.text.slice(0, 3_000),
            redactions: parsed.redactions,
            suspicious: parsed.suspicious,
            note: parsed.note ?? null,
            ...extra,
          },
          { status: sourceId ? 201 : 200 },
        );

      // Nothing is saved until the person says which they meant.
      if (intent === "unclear") return answer(null);

      const extraContext =
        [body.extraContext?.trim(), body.instruction?.trim()].filter(Boolean).join("\n") || null;

      if (intent === "resume") {
        const settings = await loadSettings(s);
        // The same cleaning a resume always gets, contact details included.
        parsed = parseResumeText(parsed.text, { stripPii: settings.stripPii ?? true });
        const sourceId = await createResumeSource(s, {
          resumeText: parsed.text,
          targetRole: body.targetRole ?? null,
          // What they typed with a resume is usually the job they are aiming for.
          jobDescription: body.jobDescription ?? body.instruction ?? null,
        });
        return answer(sourceId, {
          characters: parsed.text.length,
          preview: parsed.text.slice(0, 3_000),
          redactions: parsed.redactions,
        });
      }

      if (intent === "topics") {
        const sourceId = await createTopicSource(s, {
          topics: detected?.topics ?? [],
          ...(body.level ? { level: body.level } : {}),
          // A job ad is interview prep by nature; a syllabus is study.
          style:
            body.style ?? (detected?.document_type === "job_description" ? "interview" : "study"),
          countPerTopic: body.countPerTopic ?? 5,
          extraContext,
          scope: detected?.scope ?? null,
          referenceText: parsed.text,
        });
        return answer(sourceId);
      }

      const sourceId = await createDocumentSource(s, {
        title,
        text: parsed.text,
        level: body.level ?? null,
        style: body.style ?? "study",
        extraContext,
        scope: detected?.scope ?? null,
      });
      return answer(sourceId);
    }),

    generateFromSource: (sourceId: string) =>
      route(base, async (ctx) => {
        const s = scope(ctx);
        const { questionSources } = handle.schema;
        const { and, eq } = await import("drizzle-orm");

        const rows = await handle.db
          .select()
          .from(questionSources)
          .where(and(eq(questionSources.userId, ctx.user.id), eq(questionSources.id, sourceId)))
          .limit(1);
        const source = rows[0];
        if (!source) return fail(404, "not_found", "That is not one of your sources.");

        // A resume needs the profile pass first; topics go straight to generation.
        const jobId = await enqueue(handle, {
          type: source.kind === "resume" ? "build_profile" : "generate_questions",
          userId: ctx.user.id,
          payload: { sourceId },
          dedupeKey: `${source.kind === "resume" ? "profile" : "generate"}:${sourceId}`,
        });

        void s;
        return json({ jobId });
      }),

    deleteResumeData: (sourceId: string) =>
      route(base, async (ctx) => {
        const { filePath } = await deleteResumeData(scope(ctx), sourceId);

        // The file on disk goes too, which is the part the user actually cares about.
        if (filePath) {
          const { rm } = await import("node:fs/promises");
          await rm(filePath, { force: true }).catch(() => {});
        }

        return json({ ok: true });
      }),

    listDecks: route(base, async (ctx) => json({ decks: await listDecks(scope(ctx)) })),

    getDeck: (deckId: string) =>
      route(base, async (ctx) => {
        const s = scope(ctx);
        const deck = await findDeck(s, deckId);
        if (!deck) return fail(404, "not_found", "That is not one of your decks.");

        // When Aeyhey writes this deck's next questions: just before the next reminder.
        // Null when reminders are paused, or for a deck it does not write for.
        const settings = toCadenceSettings(await loadSettings(s));
        const now = new Date();
        const writes = deck.sourceId !== null && deck.kind !== "manual" && deck.kind !== "links";
        const nextQuestionsLabel =
          writes && !isPaused(now, settings) ? describeNextSession(now, settings) : null;

        const kept = await listQuestions(s, { deckId, reviewStatus: "kept" });
        const progress = await questionProgress(
          s,
          kept.map((q) => q.id),
          now,
        );
        const answers = await lastAnswers(
          s,
          kept.map((q) => q.id),
        );
        return json({
          deck,
          // Newest first: questions not asked yet lead (the latest written on top), then
          // the rest by when they were last asked. One entry per question however often
          // it is asked: asking again updates its card, never adds a row. When it comes
          // next is left out on purpose, so the list does not give tomorrow away.
          questions: kept
            .map((q) => ({
              ...q,
              progress: progress.get(q.id) ?? null,
              lastAnswer: answers.get(q.id) ?? null,
            }))
            .sort((a, b) => {
              const aAsked = a.progress?.lastAskedAt?.getTime() ?? null;
              const bAsked = b.progress?.lastAskedAt?.getTime() ?? null;
              if (aAsked === null && bAsked === null) return b.position - a.position;
              if (aAsked === null) return -1;
              if (bAsked === null) return 1;
              return bAsked - aAsked;
            }),
          topics: (await deckTopics(s, deck)).topics,
          nextQuestionsLabel,
        });
      }),

    getPendingReview: (sourceId: string) =>
      route(base, async (ctx) => {
        const s = scope(ctx);
        const decks = await listDecks(s);
        const deck = decks.find((candidate) => candidate.sourceId === sourceId);
        if (!deck) return json({ deck: null, questions: [] });

        return json({
          deck,
          questions: await listQuestions(s, { deckId: deck.id, reviewStatus: "pending_review" }),
        });
      }),

    acceptQuestions: route({ ...base, schema: schemas.AcceptQuestionsSchema }, async (ctx) => {
      const result = await acceptQuestions(scope(ctx), {
        keepIds: ctx.body.keepIds,
        ...(ctx.body.removeIds ? { removeIds: ctx.body.removeIds } : {}),
        ...(ctx.body.edits ? { edits: ctx.body.edits } : {}),
      });
      return json(result);
    }),

    generateMore: (deckId: string) =>
      route({ ...base, schema: schemas.GenerateMoreSchema }, async (ctx) => {
        const s = scope(ctx);
        const deck = await findDeck(s, deckId);
        if (!deck) return fail(404, "not_found", "That is not one of your decks.");
        if (!deck.sourceId) {
          return fail(
            400,
            "no_source",
            "This deck was not generated from a source, so there is nothing to generate more from.",
          );
        }

        const jobId = await enqueue(handle, {
          type: "generate_questions",
          userId: ctx.user.id,
          payload: { sourceId: deck.sourceId, deckId, count: ctx.body.count },
        });

        return json({ jobId });
      }),

    addQuestion: route({ ...base, schema: schemas.ManualQuestionSchema }, async (ctx) => {
      const id = await addManualQuestion(scope(ctx), {
        deckId: ctx.body.deckId,
        text: ctx.body.text,
        modelAnswer: ctx.body.modelAnswer,
        ...(ctx.body.keyPoints ? { keyPoints: ctx.body.keyPoints } : {}),
        ...(ctx.body.difficulty ? { difficulty: ctx.body.difficulty } : {}),
        ...(ctx.body.tags ? { tags: ctx.body.tags } : {}),
      });
      return json({ id }, { status: 201 });
    }),

    updateQuestion: (questionId: string) =>
      route({ ...base, schema: schemas.UpdateQuestionSchema }, async (ctx) => {
        const s = scope(ctx);
        if (!(await findQuestion(s, questionId))) {
          return fail(404, "not_found", "That is not one of your questions.");
        }
        await updateQuestion(s, questionId, ctx.body);
        return json({ ok: true });
      }),

    deleteQuestion: (questionId: string) =>
      route(base, async (ctx) => {
        await deleteQuestion(scope(ctx), questionId);
        return json({ ok: true });
      }),

    renameDeck: (deckId: string) =>
      route({ ...base, schema: schemas.RenameDeckSchema }, async (ctx) => {
        const s = scope(ctx);
        const deck = await findDeck(s, deckId);
        if (!deck) return fail(404, "not_found", "That is not one of your decks.");
        // The links deck is built in and named for what it holds, not by the user.
        if (ctx.body.name !== undefined && deck.kind === "links") {
          return fail(400, "deck_not_renamable", "The links deck keeps its name.");
        }

        const current = await deckTopics(s, deck);
        if (ctx.body.topicDetails) {
          const known = new Set(current.topics.map((topic) => topic.name));
          const unknown = Object.keys(ctx.body.topicDetails).filter((name) => !known.has(name));
          if (unknown.length > 0 || !current.sourceId) {
            return fail(400, "unknown_topic", "That is not one of this deck's topics.", {
              topicDetails: (unknown.length > 0 ? unknown : Object.keys(ctx.body.topicDetails)).map(
                (name) => `"${name}" is not a topic in this deck.`,
              ),
            });
          }
        }

        if (ctx.body.name !== undefined) await renameDeck(s, deckId, ctx.body.name);
        if (ctx.body.paused !== undefined && ctx.body.paused !== (deck.pausedAt !== null)) {
          await setDeckPaused(s, deckId, ctx.body.paused);
        }

        if (ctx.body.topicDetails && current.sourceId) {
          // Merged over what is there: an empty string clears that topic's details.
          const next = { ...current.details };
          for (const [name, text] of Object.entries(ctx.body.topicDetails)) {
            if (text === "") delete next[name];
            else next[name] = text;
          }
          await setTopicDetails(s, current.sourceId, next);
        }

        // The same shape GET /decks sends per item, so a client can update in place.
        const updated = (await listDecks(s)).find((candidate) => candidate.id === deckId);
        if (!updated) return fail(404, "not_found", "That is not one of your decks.");
        return json({ deck: updated, topics: (await deckTopics(s, deck)).topics });
      }),

    deleteDeck: (deckId: string) =>
      route(base, async (ctx) => {
        await deleteDeck(scope(ctx), deckId);
        return json({ ok: true });
      }),

    suspendCard: (cardId: string, suspend: boolean) =>
      route(base, async (ctx) => {
        await updateCardStatus(scope(ctx), cardId, suspend ? "suspended" : "active");
        return json({ ok: true });
      }),

    // ---------------------------------------------------------------- sessions

    currentSession: route(base, async (ctx) => json(await getOrBuildSession(scope(ctx)))),

    startSession: route({ ...base, schema: schemas.StartSessionSchema }, async (ctx) =>
      json(
        await getOrBuildSession(scope(ctx), {
          ...(ctx.body.size ? { size: ctx.body.size } : {}),
          trigger: "manual",
        }),
      ),
    ),

    cardAction: (cardId: string) =>
      route({ ...base, schema: CardActionSchema }, async (ctx) => {
        const s = scope(ctx);
        const sessionId = ctx.query.get("sessionId");

        // Answer and reveal need the grader and do not schedule, so they have their own
        // path. Everything else is a scheduling action.
        if (ctx.body.action === "answer") {
          const result = await answerQuestion({ scope: s, ai, sessionId }, cardId, ctx.body.answer);
          return json(result);
        }

        if (ctx.body.action === "reveal") {
          return json(await revealAnswer(s, cardId));
        }

        const result = await applyCardAction(
          { scope: s, sessionId, channel: "web" },
          cardId,
          ctx.body,
        );
        return json(result);
      }),

    dontKnow: (cardId: string) =>
      route(base, async (ctx) => json(await dontKnow(scope(ctx), cardId))),

    undoReview: (reviewId: string) =>
      route(base, async (ctx) => {
        const result = await undoCardAction(scope(ctx), reviewId);
        if (!result.ok) return fail(409, "cannot_undo", result.reason ?? "That cannot be undone.");
        return json({ ok: true });
      }),

    sessionSummary: (sessionId: string) =>
      route(base, async (ctx) => json(await summarizeSession(scope(ctx), sessionId))),

    // ---------------------------------------------------------------- settings

    getSettings: route(base, async (ctx) => {
      const settings = publicSettings(await loadSettings(scope(ctx)));
      return json({
        settings,
        // The UI greys these out and says "set in the environment", so a change that
        // would do nothing is visible rather than puzzling.
        locked: lockedSettingKeys(env),
        flags: registry.config.flags,
        edition: registry.config.edition,
      });
    }),

    updateSettings: route({ ...base, schema: schemas.SettingsPatchSchema }, async (ctx) => {
      await updateSettings(scope(ctx), ctx.body);
      return json({ settings: publicSettings(await loadSettings(scope(ctx))) });
    }),

    pause: route({ ...base, schema: schemas.PauseSchema }, async (ctx) => {
      if (ctx.body.indefinite) {
        await pauseIndefinitely(scope(ctx));
        return json({ pausedUntil: null, pausedIndefinitely: true });
      }
      const until = await pauseFor(scope(ctx), ctx.body.days);
      return json({ pausedUntil: until.toISOString(), pausedIndefinitely: false });
    }),

    deleteAccount: route({ ...base, schema: schemas.DeleteAccountSchema }, async (ctx) => {
      // The demo server is shared, so nobody gets to wipe it from a phone.
      if (lockedSettingKeys(env).includes("data.delete")) {
        return fail(403, "locked", "Deleting is turned off on this server.");
      }
      const result = await deleteAllData(scope(ctx), { dataDir: env.DATA_DIR });
      let accountDeleted = false;
      if (registry.auth.deleteAccount) {
        await registry.auth.deleteAccount(ctx.user.id);
        accountDeleted = true;
      }
      return json({ ...result, accountDeleted });
    }),

    resume: route(base, async (ctx) => {
      await resumeNow(scope(ctx));
      return json({ ok: true });
    }),

    // ---------------------------------------------------------------- ai providers

    listProviders: route(base, async (ctx) => {
      const { aiProviders } = handle.schema;
      const { eq } = await import("drizzle-orm");

      const rows = await handle.db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.userId, ctx.user.id));

      // The key never comes back after saving: only its last 4 characters (PRD 17).
      return json({
        providers: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          baseUrl: row.baseUrl,
          models: row.models,
          isDefault: row.isDefault,
          apiKeyPreview: row.apiKeyEnc ? maskKey("....".repeat(4)) : null,
          hasKey: Boolean(row.apiKeyEnc),
        })),
      });
    }),

    saveProvider: route({ ...base, schema: schemas.AiProviderSchema }, async (ctx) => {
      const { aiProviders } = handle.schema;

      await handle.db
        .insert(aiProviders)
        .values({
          id: newId(),
          userId: ctx.user.id,
          kind: ctx.body.kind,
          baseUrl: ctx.body.baseUrl ?? null,
          // Encrypted at rest with a key derived from APP_SECRET (PRD 17).
          apiKeyEnc: ctx.body.apiKey ? encryptSecret(ctx.body.apiKey, deps.appSecret) : null,
          models: ctx.body.models ?? {},
          isDefault: ctx.body.isDefault,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [aiProviders.userId, aiProviders.kind],
          set: {
            baseUrl: ctx.body.baseUrl ?? null,
            ...(ctx.body.apiKey
              ? { apiKeyEnc: encryptSecret(ctx.body.apiKey, deps.appSecret) }
              : {}),
            models: ctx.body.models ?? {},
            isDefault: ctx.body.isDefault,
          },
        });

      return json({ ok: true });
    }),

    testProvider: route({ ...base, schema: schemas.AiProviderSchema }, async (ctx) => {
      // Tested with what the user just typed, before it is saved, so a wrong key never
      // gets stored in the first place.
      const result = await testConnection({
        provider: ctx.body.kind,
        ...(ctx.body.baseUrl ? { baseUrl: ctx.body.baseUrl } : {}),
        ...(ctx.body.apiKey ? { apiKey: ctx.body.apiKey } : {}),
        model: ctx.body.models?.summary ?? "gpt-4o-mini",
        source: "user",
      });
      return json(result);
    }),

    // ---------------------------------------------------------------- channels

    vapidPublicKey: route({ ...base, allowAnonymous: true }, async () => {
      const built = await buildChannels({
        handle,
        env,
        appSecret: deps.appSecret,
        pushSender: registry.pushSender,
      });
      return json({ publicKey: built.vapid?.publicKey ?? null });
    }),

    subscribePush: route({ ...base, schema: schemas.PushSubscribeSchema }, async (ctx) => {
      await savePushSubscription(handle, ctx.user.id, {
        endpoint: ctx.body.endpoint,
        keys: ctx.body.keys,
        userAgent: ctx.body.userAgent ?? null,
      });
      return json({ ok: true });
    }),

    unsubscribePush: route({ ...base, schema: schemas.UnsubscribePushSchema }, async (ctx) => {
      await deletePushSubscription(handle, ctx.user.id, ctx.body.endpoint);
      return json({ ok: true });
    }),

    telegramLinkCode: route(base, async (ctx) => {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return fail(
          400,
          "not_configured",
          "Set TELEGRAM_BOT_TOKEN and restart to turn Telegram on.",
        );
      }

      const { createTelegramApi } = await import("../notify/telegram/index");
      const api = createTelegramApi(env.TELEGRAM_BOT_TOKEN);

      let username: string;
      try {
        username = (await api.getMe()).username;
      } catch {
        return fail(502, "telegram_unreachable", "Could not reach Telegram. Check the bot token.");
      }

      const result = await createLinkCode(
        {
          handle,
          botToken: env.TELEGRAM_BOT_TOKEN,
          publicUrl: env.PUBLIC_URL,
          webhookSecret: "",
          mode: env.TELEGRAM_MODE,
        },
        ctx.user.id,
        username,
      );

      return json({
        code: result.code,
        deepLink: result.deepLink,
        expiresAt: result.expiresAt.toISOString(),
      });
    }),

    requestEmailVerify: route(
      { ...base, schema: schemas.EmailVerifyRequestSchema },
      async (ctx) => {
        if (!env.SMTP_URL) {
          return fail(400, "not_configured", "Set SMTP_URL and restart to turn email on.");
        }

        await requestEmailVerification(
          {
            handle,
            smtpUrl: env.SMTP_URL,
            from: env.EMAIL_FROM,
            publicUrl: env.PUBLIC_URL,
            appSecret: deps.appSecret,
          },
          ctx.user.id,
          ctx.body.address,
        );

        return json({ ok: true });
      },
    ),

    testChannel: route({ ...base, schema: schemas.TestChannelSchema }, async (ctx) => {
      const built = await buildChannels({
        handle,
        env,
        appSecret: deps.appSecret,
        pushSender: registry.pushSender,
      });
      const channel = built.byId.get(ctx.body.channel);

      if (!channel) return fail(400, "unknown_channel", "That is not a channel Aeyhey has.");
      if (!channel.isConfigured()) {
        return fail(
          400,
          "not_configured",
          `${ctx.body.channel} is not set up on this instance yet.`,
        );
      }

      const result = await channel.sendTest(ctx.user.id);
      return json(result, { status: result.ok ? 200 : 400 });
    }),

    // ---------------------------------------------------------------- ops

    jobStatus: (jobId: string) =>
      route(base, async (ctx) => {
        const job = await findJob(handle, jobId);
        // Scoped by user, so a job id cannot be used to watch someone else's work.
        if (!job || (job.userId && job.userId !== ctx.user.id)) {
          return fail(404, "not_found", "That job is not one of yours.");
        }

        return json({
          id: job.id,
          type: job.type,
          status: job.status,
          progress: { done: job.progressDone, total: job.progressTotal },
          error: job.status === "failed" ? job.lastError : null,
          // A blocked job is waiting on the user, not broken, so it reads differently.
          blocked: job.status === "blocked" ? job.lastError : null,
        });
      }),

    // The same bundle the stats page reads. Bucketing happens in JavaScript there, so it
    // works the same on SQLite and Postgres.
    stats: route(base, async (ctx) => json(await loadStats(scope(ctx)))),

    // ---------------------------------------------------------------- today

    today: route(base, async (ctx) => json(await loadToday(scope(ctx)))),

    // ---------------------------------------------------------------- app sign-in

    /**
     * The Allow button on /connect. Needs a normal signed-in browser session, so whatever
     * sign-in the provider offers (password, magic link, OAuth) works for apps too.
     */
    connectApprove: route({ ...base, schema: schemas.ConnectApproveSchema }, async (ctx) => {
      if (readBearer(ctx.req) !== null) {
        return fail(403, "forbidden", "Approve a new app from the website, not from another app.");
      }
      if (!redirectAllowed(ctx.body.redirectUri, redirectUris)) {
        throw new InvalidRedirectError();
      }

      const code = await createAuthCode(handle, {
        userId: ctx.user.id,
        codeChallenge: ctx.body.codeChallenge,
        redirectUri: ctx.body.redirectUri,
        deviceName: ctx.body.deviceName,
      });

      const target = new URL(ctx.body.redirectUri);
      target.searchParams.set("code", code);
      if (ctx.body.state !== undefined) target.searchParams.set("state", ctx.body.state);
      return json({ redirectTo: target.toString() });
    }),

    /** The app's half of the exchange. No session: the code and verifier are the proof. */
    exchangeToken: route(
      { ...base, schema: schemas.TokenExchangeSchema, allowAnonymous: true },
      async (ctx) => {
        const issued = await exchangeAuthCode(handle, {
          code: ctx.body.code,
          codeVerifier: ctx.body.codeVerifier,
          redirectUri: ctx.body.redirectUri,
        });
        const { users } = handle.schema;
        const { eq } = await import("drizzle-orm");
        const rows = await handle.db.select().from(users).where(eq(users.id, issued.userId));
        const row = rows[0];

        return json({
          token: issued.token,
          tokenType: "Bearer",
          tokenId: issued.id,
          expiresAt: issued.expiresAt.toISOString(),
          user: row
            ? {
                id: row.id,
                ...(row.email ? { email: row.email } : {}),
                displayName: row.displayName,
                role: row.role ?? "owner",
              }
            : null,
        });
      },
    ),

    listTokens: route(base, async (ctx) =>
      json({ tokens: await listApiTokens(scope(ctx), apiTokenIdFor(ctx.req)) }),
    ),

    revokeToken: (tokenId: string) =>
      route(base, async (ctx) => {
        const revoked = await revokeApiToken(scope(ctx), tokenId);
        if (!revoked) return fail(404, "not_found", "That app is not signed in.");
        return json({ ok: true });
      }),

    // ---------------------------------------------------------------- name and picture

    getProfile: route(base, async (ctx) =>
      json({
        displayName: ctx.user.displayName,
        avatarUrl: await ownAvatarUrl(handle, ctx.user.id),
      }),
    ),

    updateProfile: route({ ...base, schema: schemas.ProfilePatchSchema }, async (ctx) => {
      const s = scope(ctx);
      if (typeof ctx.body.avatar === "string") {
        const parsed = parseAvatar(ctx.body.avatar);
        if ("problem" in parsed) {
          return fail(
            400,
            parsed.problem === "too_large" ? "avatar_too_large" : "avatar_not_image",
            parsed.problem === "too_large"
              ? "That picture is too big. Pick a smaller one."
              : "That is not a picture Aeyhey can use. Pick a JPEG, PNG or WebP.",
            { avatar: ["Pick another picture."] },
          );
        }
        await saveAvatar(s, parsed);
      } else if (ctx.body.avatar === null) {
        await removeAvatar(s);
      }
      if (ctx.body.displayName !== undefined) await setDisplayName(s, ctx.body.displayName);
      return json({
        displayName: ctx.body.displayName ?? ctx.user.displayName,
        avatarUrl: await ownAvatarUrl(handle, ctx.user.id),
      });
    }),

    ownAvatar: route(base, async (ctx) => {
      const avatar = await loadAvatar(handle, ctx.user.id);
      if (!avatar) return fail(404, "not_found", "You have no picture.");
      return avatarResponse(avatar, "private");
    }),

    /** The picture on a public page. Only while the page is on. */
    publicAvatar: (pageHandle: string) =>
      route({ ...base, allowAnonymous: true }, async () => {
        const page = await findEnabledPageOwner(handle, pageHandle);
        const avatar = page ? await loadAvatar(handle, page) : null;
        if (!avatar) return fail(404, "not_found", "There is no picture here.");
        return avatarResponse(avatar, "public");
      }),

    // ---------------------------------------------------------------- public page (PRD 28)

    getPublicPage: route(base, async (ctx) => {
      const s = scope(ctx);
      const profile = await findPublicProfile(s);
      return json({
        profile,
        url: profile ? publicPageUrl(env.PUBLIC_URL, profile.handle) : null,
        urlPrefix: publicPageUrl(env.PUBLIC_URL, ""),
        sharedCount: await countSharedLinks(s),
        suggestedHandle: profile ? null : await suggestHandle(s, ctx.user.displayName),
        // What the page shows, so the app can show it too. Computed even when the owner
        // hides it from visitors, so they can see what they would be turning on.
        ...(profile ? await ownerPagePreview(s, profile) : { stats: null, building: null }),
      });
    }),

    updatePublicPage: route({ ...base, schema: schemas.PublicProfilePatchSchema }, async (ctx) => {
      const s = scope(ctx);
      const profile = await savePublicProfile(s, {
        ...(ctx.body.handle !== undefined ? { handle: ctx.body.handle } : {}),
        ...(ctx.body.title !== undefined ? { title: ctx.body.title } : {}),
        ...(ctx.body.bio !== undefined ? { bio: ctx.body.bio } : {}),
        ...(ctx.body.enabled !== undefined ? { enabled: ctx.body.enabled } : {}),
        ...(ctx.body.indexable !== undefined ? { indexable: ctx.body.indexable } : {}),
        ...(ctx.body.showFooter !== undefined ? { showFooter: ctx.body.showFooter } : {}),
        ...(ctx.body.showStats !== undefined ? { showStats: ctx.body.showStats } : {}),
        ...(ctx.body.buildingVisibility !== undefined
          ? { buildingVisibility: ctx.body.buildingVisibility }
          : {}),
        ...(ctx.body.showAgentModels !== undefined
          ? { showAgentModels: ctx.body.showAgentModels }
          : {}),
        ...(ctx.body.headline !== undefined ? { headline: ctx.body.headline } : {}),
        ...(ctx.body.location !== undefined ? { location: ctx.body.location } : {}),
        ...(ctx.body.links !== undefined ? { links: ctx.body.links } : {}),
        ...(ctx.body.skills !== undefined ? { skills: ctx.body.skills } : {}),
        ...(ctx.body.interests !== undefined ? { interests: ctx.body.interests } : {}),
        ...(ctx.body.experience !== undefined ? { experience: ctx.body.experience } : {}),
        ...(ctx.body.projects !== undefined ? { projects: ctx.body.projects } : {}),
      });
      return json({
        profile,
        url: publicPageUrl(env.PUBLIC_URL, profile.handle),
        urlPrefix: publicPageUrl(env.PUBLIC_URL, ""),
        sharedCount: await countSharedLinks(s),
        suggestedHandle: null,
        ...(await ownerPagePreview(s, profile)),
      });
    }),

    /** A draft of the work side from the newest resume, to edit before saving. */
    resumeDraft: route(base, async (ctx) => {
      const draft = await resumeDraft(scope(ctx));
      if (!draft) return fail(404, "no_resume", "There is no resume to fill this from yet.");
      return json(draft);
    }),

    checkHandle: route(base, async (ctx) => {
      const wanted = normalizeHandle(ctx.query.get("handle") ?? "");
      const problem = handleProblem(wanted);
      const available = problem ? false : await handleAvailable(scope(ctx), wanted);
      return json({
        handle: wanted,
        available,
        problem: problem ?? (available ? null : "Someone already has that name. Try another."),
      });
    }),

    listSharedLinks: route(base, async (ctx) => {
      const { limit, cursor } = parseListQuery(ctx.query);
      return json(await listSharedLinks(scope(ctx), { limit, cursor: cursor ?? null }));
    }),

    /** The owner's own day feed: what visitors see, with each link's id for editing. */
    ownerPageDays: route(base, async (ctx) => {
      const profile = await findPublicProfile(scope(ctx));
      if (!profile) return fail(404, "not_found", "Set up your page first.");
      return json(
        await loadPublicDays(scope(ctx), {
          before: ctx.query.get("before"),
          showBuilt: profile.buildingVisibility === "highlights",
          withIds: true,
        }),
      );
    }),

    shareLink: (linkId: string) =>
      route({ ...base, schema: schemas.ShareLinkSchema }, async (ctx) => {
        const shared = await shareLink(scope(ctx), linkId, ctx.body.takeaway);
        if (!shared) return fail(404, "not_found", "That link is not in your collection.");
        return json({ ok: true, sharedAt: shared.sharedAt.toISOString() });
      }),

    unshareLink: (linkId: string) =>
      route(base, async (ctx) => {
        const removed = await unshareLink(scope(ctx), linkId);
        if (!removed) return fail(404, "not_found", "That link is not in your collection.");
        return json({ ok: true });
      }),

    /** For anyone, signed in or not. A page that is off looks exactly like no page. */
    publicPage: (pageHandle: string) =>
      route({ ...base, allowAnonymous: true }, async (ctx) => {
        const page = await publicPageByHandle(handle, pageHandle, {
          cursor: ctx.query.get("cursor"),
        });
        if (!page) {
          const moved = await movedHandle(handle, pageHandle);
          if (moved) {
            return new Response(null, {
              status: 301,
              headers: { location: `/api/u/${moved}`, "cache-control": "public, max-age=300" },
            });
          }
          return fail(404, "not_found", "There is no page here.");
        }
        // Short cache, so unsharing takes effect almost at once (FR-PUB-8).
        return json(page, { headers: { "cache-control": "public, max-age=30" } });
      }),

    /** Older days of the "What I learned" feed, seven at a time, for anyone. */
    publicDays: (pageHandle: string) =>
      route({ ...base, allowAnonymous: true }, async (ctx) => {
        const ownerId = await findEnabledPageOwner(handle, pageHandle);
        if (!ownerId) return fail(404, "not_found", "There is no page here.");
        const owner = scopeFor(handle, ownerId);
        const profile = await findPublicProfile(owner);
        const page = await loadPublicDays(owner, {
          before: ctx.query.get("before"),
          showBuilt: profile?.buildingVisibility === "highlights",
        });
        return json(page, { headers: { "cache-control": "public, max-age=30" } });
      }),

    // ---------------------------------------------------------------- devices

    registerDevice: route({ ...base, schema: schemas.RegisterDeviceSchema }, async (ctx) => {
      const id = await registerDevice(scope(ctx), {
        platform: ctx.body.platform,
        pushToken: ctx.body.pushToken,
        appVersion: ctx.body.appVersion ?? null,
        apiTokenId: apiTokenIdFor(ctx.req) ?? null,
      });
      return json({ id, pushEnabled: registry.pushSender !== null });
    }),

    unregisterDevice: route({ ...base, schema: schemas.UnregisterDeviceSchema }, async (ctx) => {
      await unregisterDevice(scope(ctx), ctx.body.pushToken);
      return json({ ok: true });
    }),
  };
}

/**
 * Where a handle's page lives. The hosted edition serves the same page on
 * <handle>.aeyhey.com as well (PRD 28.6), but the path always works.
 */
export function publicPageUrl(publicUrl: string, pageHandle: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/u/${pageHandle}`;
}

/** A free handle from the user's name, or null when the name gives nothing usable. */
async function suggestHandle(
  s: ReturnType<typeof scopeFor>,
  displayName: string | undefined,
): Promise<string | null> {
  const base = normalizeHandle(displayName ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!base || base === "you") return null;
  for (const candidate of [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)]) {
    if (!handleProblem(candidate) && (await handleAvailable(s, candidate))) return candidate;
  }
  return null;
}

export type Api = ReturnType<typeof createApi>;
export { log as apiLogger };

/**
 * Serves a stored picture. The type comes from its bytes, nosniff stops a browser from
 * guessing otherwise, and the URL carries a version, so it can be cached for a long time.
 */
function avatarResponse(
  avatar: { mime: string; bytes: Buffer },
  cache: "public" | "private",
): Response {
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "content-type": avatar.mime,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "cache-control":
        cache === "public" ? "public, max-age=86400" : "private, max-age=31536000, immutable",
    },
  });
}
