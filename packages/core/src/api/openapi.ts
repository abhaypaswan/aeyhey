// SPDX-License-Identifier: AGPL-3.0-only
// Builds the OpenAPI document from API_MANIFEST and the Zod request schemas.
//
// Request bodies are exact, because they come from the same schemas the server validates
// with. Most response bodies are not described yet: they are typed in TypeScript but have
// no Zod schema, so they appear as a plain object. An entry with a `response` schema gets
// that instead. Every error has the same shape, and that one is described.

import { z } from "zod";
import { API_MANIFEST, type ManifestEntry } from "./manifest";

export const API_VERSION = "1";

type Json = Record<string, unknown>;

function bodySchema(entry: ManifestEntry): Json | null {
  if (!entry.body) return null;
  return z.toJSONSchema(entry.body, { target: "openapi-3.0", io: "input" }) as Json;
}

function responseSchema(entry: ManifestEntry): Json {
  if (!entry.response) return { type: "object" };
  return z.toJSONSchema(entry.response, { target: "openapi-3.0", io: "output" }) as Json;
}

function operationId(entry: ManifestEntry): string {
  const words = entry.path
    .split("/")
    .filter(Boolean)
    .map((part) => (part.startsWith("{") ? "by-" + part.slice(1, -1) : part))
    .join("-")
    .split(/[-_]/)
    .filter(Boolean);
  const camel = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  return entry.method.toLowerCase() + camel;
}

const ERROR_SCHEMA: Json = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", description: "Stable, for code to branch on." },
        message: { type: "string", description: "Written for the person, safe to show." },
        fields: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
          description: "Per-field messages when the body did not validate.",
        },
      },
    },
  },
};

function errorResponse(description: string): Json {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

export function buildOpenApi(): Json {
  const paths: Record<string, Record<string, Json>> = {};

  for (const entry of API_MANIFEST) {
    const parameters: Json[] = [];
    for (const match of entry.path.matchAll(/\{([^}]+)\}/g)) {
      parameters.push({ name: match[1], in: "path", required: true, schema: { type: "string" } });
    }
    for (const name of entry.query ?? []) {
      parameters.push({ name, in: "query", required: false, schema: { type: "string" } });
    }

    const body = bodySchema(entry);
    const operation: Json = {
      operationId: operationId(entry),
      summary: entry.summary,
      tags: [entry.tag],
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(body
        ? { requestBody: { required: true, content: { "application/json": { schema: body } } } }
        : {}),
      responses: {
        "200": {
          description: "OK",
          content: { "application/json": { schema: responseSchema(entry) } },
        },
        "400": errorResponse("The request was not valid."),
        ...(entry.auth === "user" ? { "401": errorResponse("Not signed in.") } : {}),
        default: errorResponse("Something else went wrong."),
      },
      ...(entry.auth === "user" ? {} : { security: [] }),
      ...(entry.internal ? { "x-internal": true } : {}),
    };

    (paths[entry.path] ??= {})[entry.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Aeyhey API",
      version: API_VERSION,
      description:
        "Generated from packages/core/src/api/manifest.ts by `pnpm api:spec`. Do not edit by hand. " +
        "Apps sign in through /connect and send `Authorization: Bearer <token>`; see docs/api.md.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearer: [] }, { cookie: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An app token from /auth/token." },
        cookie: { type: "apiKey", in: "cookie", name: "aeyhey_session" },
      },
      schemas: { Error: ERROR_SCHEMA },
    },
    paths,
  };
}
