// SPDX-License-Identifier: AGPL-3.0-only
// The public surface of @aeyhey/core.
//
// apps/web imports from here and from the subpath exports in package.json. The private
// repo imports only from "@aeyhey/core/extensions", which is a narrower and more stable
// contract on purpose (PRD 23.6).

export * from "./env";
export * from "./ids";
export * from "./logger";
export * as db from "./db/index";
export * as api from "./api/index";
export * as ai from "./ai/index";
export * as jobs from "./jobs/index";
export * as links from "./links/index";
export * as questions from "./questions/index";
export * as notify from "./notify/index";
export * as repos from "./repos/index";
export * as scheduler from "./scheduler/index";
export * as security from "./security/index";
export * as sessions from "./sessions/index";
export * as seed from "./seed/index";
export * as extensions from "./extensions/index";
export * as assistant from "./assistant/index";
