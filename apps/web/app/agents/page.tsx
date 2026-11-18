// SPDX-License-Identifier: AGPL-3.0-only
// /agents: how to connect a coding agent to Aeyhey. Public, since the agent that reads it
// is not signed in and there is nothing secret on it. The same steps are at /agents.md
// as plain Markdown, which is the address the prompt in Settings gives an agent.

import type { Metadata } from "next";
import { env as loadEnv } from "@aeyhey/core";
import { agentSetup, type SetupBlock } from "../../lib/agent-setup";
import { CopyCode } from "../../components/copy-code";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect a coding agent",
  description:
    "Set up Claude Code, Codex, Cursor, Gemini CLI or any MCP agent to work with Aeyhey.",
};

/** `code` in the setup text, drawn as code. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={index}
            className="bg-sunken border-border rounded-md border px-1 py-px font-mono text-[0.86em] [overflow-wrap:anywhere]"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: SetupBlock }) {
  if (block.kind === "p") {
    return (
      <p className="text-[15.5px] leading-[1.6]">
        <Inline text={block.text} />
      </p>
    );
  }
  if (block.kind === "steps") {
    return (
      <ol className="marker:text-muted-foreground flex list-decimal flex-col gap-2.5 pl-5 text-[15.5px] leading-[1.6] marker:font-semibold">
        {block.items.map((item) => (
          <li key={item} className="pl-1">
            <Inline text={item} />
          </li>
        ))}
      </ol>
    );
  }
  return <CopyCode text={block.text} {...(block.label ? { label: block.label } : {})} />;
}

export default function AgentsPage() {
  const setup = agentSetup(loadEnv().PUBLIC_URL);
  return (
    <main className="mx-auto w-full max-w-3xl px-[22px] pb-24 pt-6 sm:px-6 lg:pt-12">
      <h1 className="font-display text-[34px] font-[650] leading-[1.05] tracking-[-0.02em] lg:text-[46px]">
        {setup.title}
      </h1>
      <p className="text-muted-foreground mt-4 text-[17px] leading-[1.55]">{setup.intro}</p>
      <p className="text-muted-foreground mt-3 text-sm">
        The quickest way: in Aeyhey, open Settings, Agents, make a token and copy the prompt it
        gives you into your agent. It reads this page and does the rest. Agents can also read it as{" "}
        <a href="/agents.md" className="text-primary font-semibold hover:underline">
          plain Markdown
        </a>
        .
      </p>

      <nav aria-label="Agents" className="mt-6 flex flex-wrap gap-2">
        {setup.sections.slice(1, -1).map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="border-border hover:bg-quiet rounded-full border px-3.5 py-1.5 text-sm font-medium"
          >
            {section.title}
          </a>
        ))}
      </nav>

      {setup.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-title`}
          className="border-border mt-10 flex scroll-mt-24 flex-col gap-4 border-t pt-8"
        >
          <h2
            id={`${section.id}-title`}
            className="font-display text-[24px] font-[640] leading-tight tracking-[-0.01em]"
          >
            {section.title}
          </h2>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </main>
  );
}
