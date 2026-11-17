// SPDX-License-Identifier: AGPL-3.0-only
// A small structured logger. Every value goes through the redactor first (PRD 17).

import { redactString, redactValue } from "./security/redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : "info";
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function emit(
  level: LogLevel,
  scope: string,
  bindings: Record<string, unknown>,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;

  const record = {
    at: new Date().toISOString(),
    level,
    scope,
    msg: redactString(message),
    ...(redactValue({ ...bindings, ...fields }) as Record<string, unknown>),
  };

  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string, bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, f) => emit("debug", scope, bindings, m, f),
    info: (m, f) => emit("info", scope, bindings, m, f),
    warn: (m, f) => emit("warn", scope, bindings, m, f),
    error: (m, f) => emit("error", scope, bindings, m, f),
    child: (extra) => createLogger(scope, { ...bindings, ...extra }),
  };
}

export const log = createLogger("aeyhey");
