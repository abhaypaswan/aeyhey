// SPDX-License-Identifier: AGPL-3.0-only
// The typed fetch wrapper the UI uses.
//
// One place turns an API error body into a thrown Error with the message the server wrote,
// so every screen can show that message rather than inventing its own.

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string[]> };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    // The session cookie is HTTP-only, so it has to ride along explicitly.
    credentials: "same-origin",
  });

  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // A non-JSON error body, such as a proxy's 502 page.
    }
    throw new ApiRequestError(
      response.status,
      body.error?.code ?? "error",
      body.error?.message ?? `That did not work (${response.status}).`,
      body.error?.fields,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
};

/** Polls a job until it finishes. Used by the generate flows (PRD 12.2). */
export interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed" | "blocked";
  progress: { done: number; total: number | null };
  error: string | null;
  blocked: string | null;
}

export async function waitForJob(
  jobId: string,
  options: { onProgress?: (status: JobStatus) => void; timeoutMs?: number } = {},
): Promise<JobStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
  let delay = 600;

  for (;;) {
    const status = await apiClient.get<JobStatus>(`/api/jobs/${jobId}`);
    options.onProgress?.(status);

    if (status.status === "done" || status.status === "failed" || status.status === "blocked") {
      return status;
    }
    if (Date.now() > deadline) return status;

    await new Promise((resolve) => setTimeout(resolve, delay));
    // Back off a little, so a long generation does not hammer the endpoint.
    delay = Math.min(delay * 1.4, 3_000);
  }
}
