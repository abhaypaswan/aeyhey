// SPDX-License-Identifier: AGPL-3.0-only
// The single entry point the private repo imports from: @aeyhey/core/extensions.
// Anything exported here is a stable contract. Removing or narrowing something in this
// file is a breaking change for the hosted edition, so it goes through a normal PR.

export * from "./edition";
export * from "./auth";
export * from "./ai-credentials";
export * from "./usage";
export * from "./api-tokens";
export * from "./push-sender";
export * from "./plugin";
export * from "./registry";
export * from "./init";
export * from "./defaults/index";
export {
  CONTRACT_TASK,
  TASK_MAX_OUTPUT_TOKENS,
  TOKEN_BUDGETS,
  type ContractName,
} from "../ai/contracts/index";
