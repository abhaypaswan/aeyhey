"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// A block of text to copy: a command, a config file, a prompt. The label sits above it
// with a Copy button, and long lines scroll inside the block rather than the page.

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "./ui";

export function CopyCode({
  text,
  label,
  wrap = false,
  className,
}: {
  text: string;
  label?: string;
  /** Wrap long lines, for prose such as a prompt, instead of scrolling them. */
  wrap?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-semibold">{label ?? ""}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-primary hover:bg-quiet flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={cx(
          "border-border bg-sunken rounded-xl border p-3 font-mono text-[12.5px] leading-[1.55]",
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
        )}
      >
        {text}
      </pre>
    </div>
  );
}
