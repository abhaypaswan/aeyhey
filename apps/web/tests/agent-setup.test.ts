// SPDX-License-Identifier: AGPL-3.0-only
// The public page that tells a coding agent how to connect itself, and the prompt that
// sends it there. The page is public, so it must never carry a token; the prompt must.

import { describe, expect, it } from "vitest";
import { agentPrompt, agentSetup, agentSetupMarkdown, mcpUrl } from "../lib/agent-setup";

describe("the agent setup page", () => {
  const base = "https://aeyhey.example/";

  it("points every agent at this instance's MCP server", () => {
    expect(mcpUrl(base)).toBe("https://aeyhey.example/api/v1/mcp");
    const markdown = agentSetupMarkdown(base);
    for (const agent of ["Claude Code", "Codex", "Cursor", "Gemini CLI", "Any other agent"]) {
      expect(markdown).toContain(`## ${agent}`);
    }
    expect(markdown).toContain("https://aeyhey.example/api/v1/mcp");
    expect(markdown).not.toContain("example//");
  });

  it("never holds a token, only the place to put one", () => {
    const markdown = agentSetupMarkdown(base);
    expect(markdown).not.toMatch(/ahy_[A-Za-z0-9]{8,}/);
    expect(markdown).toContain("AEYHEY_TOKEN");
  });

  it("is Markdown an agent can follow: numbered steps and fenced code", () => {
    const markdown = agentSetupMarkdown(base);
    expect(markdown).toMatch(/^# Connect a coding agent to Aeyhey/);
    expect(markdown).toMatch(/\n1\. .+\n2\. /);
    expect(markdown).toContain('[mcp_servers.aeyhey]\nurl = "https://aeyhey.example/api/v1/mcp"');
    expect(agentSetup(base).sections.length).toBeGreaterThan(5);
  });

  it("gives the agent the page and the token in one prompt", () => {
    const prompt = agentPrompt(base, "ahy_abc123");
    expect(prompt).toContain("https://aeyhey.example/agents.md");
    expect(prompt).toContain("ahy_abc123");
  });
});
