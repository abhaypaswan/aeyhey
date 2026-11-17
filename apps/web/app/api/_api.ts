// SPDX-License-Identifier: AGPL-3.0-only
// The API instance, built once per process.
//
// Every route file under app/api imports from here, so the AI rate limiter, the registry
// and the database handle are shared rather than rebuilt per request.

import { createApi, type Api } from "@aeyhey/core/api";
import { getRuntime } from "../../runtime";

let cached: Promise<Api> | null = null;

export function api(): Promise<Api> {
  if (!cached) {
    cached = getRuntime().then((runtime) =>
      createApi({
        handle: runtime.handle,
        env: runtime.env,
        registry: runtime.registry,
        appSecret: runtime.appSecret,
      }),
    );
  }
  return cached;
}
