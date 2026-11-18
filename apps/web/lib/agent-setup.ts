// SPDX-License-Identifier: AGPL-3.0-only
// How to connect a coding agent to Aeyhey, written for the agent to read and follow.
//
// The person copies one prompt from Settings, Agents with this page's address in it, and
// their agent (Claude Code, Codex, Cursor, Gemini CLI or anything else that speaks MCP)
// reads the page and sets itself up. Agents sign in through the browser, the way MCP
// servers such as Vercel's or Supabase's work, so no token is copied anywhere. A token is
// only for the few things that cannot open a browser, such as Claude Code's session hook.
// The same content is served as a page at /agents for people and as plain Markdown at
// /agents.md for agents, so the two cannot drift apart.

export type SetupBlock =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "code"; label?: string; text: string };

export interface SetupSection {
  id: string;
  title: string;
  blocks: SetupBlock[];
}

export interface AgentSetup {
  title: string;
  intro: string;
  sections: SetupSection[];
}

/** The address of the MCP server, from the instance's public URL. */
export function mcpUrl(base: string): string {
  return `${trimBase(base)}/api/v1/mcp`;
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

export function agentSetup(baseUrl: string): AgentSetup {
  const base = trimBase(baseUrl);
  const mcp = mcpUrl(base);

  return {
    title: "Connect a coding agent to Aeyhey",
    intro: `Aeyhey (${base}) helps a person remember what they read and learn. Connected to it, a coding agent can save links to their Aeyhey inbox and note what they finish, so Aeyhey can write a short summary of their day. It only ever sends a one-line note or a link, never code, prompts or file contents.`,
    sections: [
      {
        id: "for-the-agent",
        title: "If you are the agent reading this",
        blocks: [
          {
            kind: "steps",
            items: [
              "Add the Aeyhey MCP server to your own user-level configuration, using the section below for the agent you are. If you are none of them, follow Any other agent. No token or key is needed: Aeyhey signs you in through the browser.",
              "Start the sign-in, as your section says. The person's browser opens on Aeyhey, they sign in if they need to, and they tap Allow. If you cannot start it yourself, tell the person exactly what to run or click.",
              "Check that it works: list your MCP servers or tools. You should see `aeyhey` with the tools `highlight` and `save_link`. If your configuration only loads at start, tell the person to restart you.",
              "Tell the person what you set up and where.",
            ],
          },
          { kind: "p", text: "The server, for any agent:" },
          { kind: "code", label: "MCP server (Streamable HTTP, browser sign-in)", text: mcp },
        ],
      },
      {
        id: "claude-code",
        title: "Claude Code",
        blocks: [
          { kind: "p", text: "Add the server for every project:" },
          { kind: "code", text: `claude mcp add --transport http --scope user aeyhey ${mcp}` },
          {
            kind: "p",
            text: "Then sign in: in Claude Code, run `/mcp`, pick `aeyhey` and choose Authenticate. A running session cannot do this for itself, so ask the person to.",
          },
          {
            kind: "p",
            text: "Optional: Claude Code can also report each finished session with a hook, which sends only counts and names (times, token counts and models, tool calls, lines changed, file types and commit messages). A hook cannot sign in through a browser, so it needs a token: the person makes one in Aeyhey under Settings, Agents, Make a token. Download the hook:",
          },
          {
            kind: "code",
            text: `mkdir -p ~/.claude && curl -fsSL ${base}/agents/claude-code-session-end.mjs -o ~/.claude/aeyhey-session-end.mjs`,
          },
          {
            kind: "p",
            text: "Then merge this into `~/.claude/settings.json`, keeping everything already there, with the token in place of `<the token>`. Never put it in a project's files. The hook needs Node 18 or later.",
          },
          {
            kind: "code",
            label: "~/.claude/settings.json",
            text: JSON.stringify(
              {
                env: { AEYHEY_URL: base, AEYHEY_TOKEN: "<the token>" },
                hooks: {
                  SessionEnd: [
                    {
                      hooks: [
                        { type: "command", command: "node ~/.claude/aeyhey-session-end.mjs" },
                      ],
                    },
                  ],
                },
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        id: "codex",
        title: "Codex",
        blocks: [
          { kind: "p", text: "Add this to `~/.codex/config.toml`:" },
          {
            kind: "code",
            label: "~/.codex/config.toml",
            text: `[mcp_servers.aeyhey]\nurl = "${mcp}"`,
          },
          { kind: "p", text: "Then sign in, which opens the browser:" },
          { kind: "code", text: "codex mcp login aeyhey" },
        ],
      },
      {
        id: "cursor",
        title: "Cursor",
        blocks: [
          {
            kind: "p",
            text: "Merge this into `~/.cursor/mcp.json`, keeping any servers already there. Then in Cursor Settings, MCP, `aeyhey` shows as needing sign-in: the person clicks it, and the browser opens.",
          },
          {
            kind: "code",
            label: "~/.cursor/mcp.json",
            text: JSON.stringify({ mcpServers: { aeyhey: { url: mcp } } }, null, 2),
          },
        ],
      },
      {
        id: "gemini-cli",
        title: "Gemini CLI",
        blocks: [
          {
            kind: "p",
            text: "Merge this into `~/.gemini/settings.json`, keeping everything already there. Then in Gemini CLI run `/mcp auth aeyhey` to sign in through the browser.",
          },
          {
            kind: "code",
            label: "~/.gemini/settings.json",
            text: JSON.stringify({ mcpServers: { aeyhey: { httpUrl: mcp } } }, null, 2),
          },
        ],
      },
      {
        id: "any-other-agent",
        title: "Any other agent",
        blocks: [
          {
            kind: "p",
            text: `Add an MCP server named \`aeyhey\` at \`${mcp}\` (Streamable HTTP) in your user-level configuration. Agents that support MCP sign-in find it on their own: the server answers without a token with a 401 that points to it, and they open the browser.`,
          },
          {
            kind: "p",
            text: "If your agent cannot sign in through a browser, use a token instead: the person makes one in Aeyhey under Settings, Agents, Make a token, and you send it as the header `Authorization: Bearer <the token>`. Keep it in your user-level configuration or an environment variable, never in a project's files.",
          },
        ],
      },
      {
        id: "using-it",
        title: "Once it is connected",
        blocks: [
          {
            kind: "p",
            text: "Call `highlight` with one short line, in the past tense, when the person reaches a real goal or asks you to note something. Not for every task, and never with code or secrets. Call `save_link` when they ask you to save a link to read later. The server repeats these rules when you connect.",
          },
          {
            kind: "p",
            text: "The agent can only add notes and links. It cannot read anything in Aeyhey. The person sees it under Settings, Data, Signed-in apps, and can sign it out there at any time.",
          },
        ],
      },
    ],
  };
}

/** The prompt the person copies into their agent. No secret in it: the agent signs in. */
export function agentPrompt(baseUrl: string): string {
  const base = trimBase(baseUrl);
  return `Connect yourself to my Aeyhey, so you can save links for me and note what we finish. Read ${base}/agents.md and follow the steps for the agent you are.`;
}

/** The whole setup as Markdown, for an agent to read. */
export function agentSetupMarkdown(baseUrl: string): string {
  const setup = agentSetup(baseUrl);
  const out: string[] = [`# ${setup.title}`, "", setup.intro, ""];
  for (const section of setup.sections) {
    out.push(`## ${section.title}`, "");
    for (const block of section.blocks) {
      if (block.kind === "p") out.push(block.text, "");
      else if (block.kind === "steps") {
        block.items.forEach((item, index) => out.push(`${index + 1}. ${item}`));
        out.push("");
      } else {
        if (block.label) out.push(`${block.label}:`, "");
        out.push("```", block.text, "```", "");
      }
    }
  }
  return out.join("\n").trimEnd() + "\n";
}
