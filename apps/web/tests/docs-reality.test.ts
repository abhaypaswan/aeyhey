// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("README product claims", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

  it("matches the current question, export, hosted, and configuration behavior", () => {
    expect(readme).toContain("Generated questions are kept in the deck automatically");
    expect(readme).toContain("Restoring from that export is not available yet");
    expect(readme).toContain("[aeyhey.app](https://aeyhey.app)");
    expect(readme).not.toContain("docs/configuration.md");
    expect(readme).not.toContain("and an import for it");
  });
});
