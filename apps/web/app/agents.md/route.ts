// SPDX-License-Identifier: AGPL-3.0-only
// /agents.md: how to connect a coding agent, as plain Markdown for the agent to read.
// Public on purpose: it holds no secrets, and the agent fetching it is not signed in.
import { env as loadEnv } from "@aeyhey/core";
import { agentSetupMarkdown } from "../../lib/agent-setup";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(agentSetupMarkdown(loadEnv().PUBLIC_URL), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
