// SPDX-License-Identifier: AGPL-3.0-only
// Runs migrations and exits. The container entrypoint calls this before starting web.
import { getRuntime, shutdown } from "./runtime";

await getRuntime({ migrate: true });
await shutdown();
console.log("[aeyhey] migrations are up to date.");
