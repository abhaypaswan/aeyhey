// SPDX-License-Identifier: AGPL-3.0-only
// The worker process. Same codebase as the web app, different command (PRD 15).
//
// It polls the jobs table every 2 seconds, runs the reminder loop every minute, writes a
// heartbeat that /api/health reports on, and sweeps link expiry hourly.

import { jobs } from "@aeyhey/core";
import { getRuntime, shutdown } from "./runtime";

const { handle, env, registry, appSecret } = await getRuntime({ migrate: false });

const worker = jobs.createWorker({
  handle,
  env,
  registry,
  appSecret,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[aeyhey] ${signal} received, finishing the current job then stopping.`);
    worker.stop();
    // Give the in-flight job a moment, then go whatever happens.
    setTimeout(() => {
      void shutdown().then(() => process.exit(0));
    }, 2_000);
  });
}

console.log(
  `[aeyhey] worker running. ${registry.jobs.length} plugin handler(s), edition ${registry.config.edition}.`,
);

await worker.run();
await shutdown();
