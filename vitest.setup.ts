// SPDX-License-Identifier: AGPL-3.0-only
// Tests assert on behaviour, not on log output, so the logger stays quiet unless a test
// raises the level itself.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";

import { afterEach, vi } from "vitest";

// A test that fails before its own mockRestore would otherwise leak the mock into the
// next test, which turns one real failure into several confusing ones.
afterEach(() => {
  vi.restoreAllMocks();
});
