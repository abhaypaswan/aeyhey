// SPDX-License-Identifier: AGPL-3.0-only
// How to connect a coding agent to Aeyhey, written for the agent to read and follow.
//
// The person copies one prompt from Settings, Agents: it carries this page's address and
// their agent token, and their agent (Claude Code, Codex, Cursor, Gemini CLI or anything
// else that speaks MCP) reads the page and sets itself up. The same content is served as
// a page at /agents for people and as plain Markdown at /agents.md for agents, so the
// two cannot drift apart. Nothing here is secret: the token only ever arrives in the
// prompt, never on this public page.

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
              "Find the person's agent token. It starts with `ahy_` and should be in the message that sent you here. If it is not, ask them to make one in Aeyhey under Settings, Agents, and wait for it.",
              "Store the token as the environment variable `AEYHEY_TOKEN` in the person's shell profile (`~/.zshrc`, `~/.bashrc` or the equivalent), so it is set wherever you run. Never write it into a project, a repository or a file that is committed, and do not repeat it back in your reply.",
              "Add the Aeyhey MCP server to your own user-level configuration, using the section below for the agent you are. If you are none of them, follow Any other agent.",
              "Check that it works: list your MCP servers or tools. You should see `aeyhey` with the tools `highlight` and `save_link`. If your configuration only loads at start, tell the person to restart you.",
              "Tell the person what you set up and where, without showing the token.",
            ],
          },
          { kind: "p", text: "The server, for any agent:" },
          { kind: "code", label: "MCP server (Streamable HTTP)", text: mcp },
          { kind: "code", label: "Header", text: "Authorization: Bearer <the agent token>" },
        ],
      },
      {
        id: "claude-code",
        title: "Claude Code",
        blocks: [
          {
            kind: "p",
            text: "Add the server for every project, reading the token from the environment:",
          },
          {
            kind: "code",
            text: `claude mcp add --transport http --scope user aeyhey ${mcp} --header "Authorization: Bearer $AEYHEY_TOKEN"`,
          },
          {
            kind: "p",
            text: "Claude Code can also report each finished session on its own, with a hook. It sends only counts and names: times, token counts and models, tool calls, lines changed, file types and commit messages. Download it:",
          },
          {
            kind: "code",
            text: `mkdir -p ~/.claude && curl -fsSL ${base}/agents/claude-code-session-end.mjs -o ~/.claude/aeyhey-session-end.mjs`,
          },
          {
            kind: "p",
            text: "Then merge this into `~/.claude/settings.json`, keeping everything already there. Put the real token in place of `$AEYHEY_TOKEN`, since this file does not read the shell. The hook needs Node 18 or later.",
          },
          {
            kind: "code",
            label: "~/.claude/settings.json",
            text: JSON.stringify(
              {
                env: { AEYHEY_URL: base, AEYHEY_TOKEN: "$AEYHEY_TOKEN" },
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
          {
            kind: "p",
            text: "Add this to `~/.codex/config.toml`. Codex reads the token from `AEYHEY_TOKEN` when it starts, so that variable must be set in the shell Codex runs from.",
          },
          {
            kind: "code",
            label: "~/.codex/config.toml",
            text: `[mcp_servers.aeyhey]\nurl = "${mcp}"\nbearer_token_env_var = "AEYHEY_TOKEN"`,
          },
        ],
      },
      {
        id: "cursor",
        title: "Cursor",
        blocks: [
          {
            kind: "p",
            text: "Merge this into `~/.cursor/mcp.json`, keeping any servers already there, then restart Cursor so it picks up the server and the variable.",
          },
          {
            kind: "code",
            label: "~/.cursor/mcp.json",
            text: JSON.stringify(
              {
                mcpServers: {
                  aeyhey: {
                    url: mcp,
                    headers: { Authorization: "Bearer ${env:AEYHEY_TOKEN}" },
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        id: "gemini-cli",
        title: "Gemini CLI",
        blocks: [
          {
            kind: "p",
            text: "Merge this into `~/.gemini/settings.json`, keeping everything already there, with the real token in place of `<the agent token>`. Then check it with `gemini mcp list`.",
          },
          {
            kind: "code",
            label: "~/.gemini/settings.json",
            text: JSON.stringify(
              {
                mcpServers: {
                  aeyhey: {
                    httpUrl: mcp,
                    headers: { Authorization: "Bearer <the agent token>" },
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        id: "any-other-agent",
        title: "Any other agent",
        blocks: [
          {
            kind: "p",
            text: `Any agent that supports MCP over Streamable HTTP can connect. Add a server named \`aeyhey\` at \`${mcp}\` with the header \`Authorization: Bearer <the agent token>\`, in your user-level configuration rather than a project's, so the token stays out of repositories.`,
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
            text: "The token can only add notes and links. It cannot read anything in Aeyhey. The person can sign it out at any time in Aeyhey under Settings, Data, Signed-in apps.",
          },
        ],
      },
    ],
  };
}

/** The prompt the person copies into their agent, with their token in it. */
export function agentPrompt(baseUrl: string, token: string): string {
  const base = trimBase(baseUrl);
  return `Connect yourself to my Aeyhey account, so you can save links for me and note what we finish. Read ${base}/agents.md and follow the steps for the agent you are. My Aeyhey agent token is ${token}. Keep it out of any project files and do not repeat it back to me.`;
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
