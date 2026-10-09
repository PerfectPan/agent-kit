// The built `/harness/events` entry imports nothing, so a hook process loads it on its own; tsdown bundles zod/mini
// into it if the path ever uses one. The path reads a handful of fields, so payloads are checked with typeof guards.
// Every lookup uses own properties only: an event named "constructor" must not find Object.prototype.

import type { FieldPath, FieldSource } from "../value-objects/hook-dialect.js";

export type Env = Readonly<Record<string, string | undefined>>;

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ownValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function valueAt(payload: unknown, path: FieldPath): unknown {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    value = Object.hasOwn(value, key) ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
  }
  return value;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The first non-empty value among the source's payload paths, then its environment variables. */
export function readField(payload: unknown, env: Env, source: FieldSource | undefined): string | undefined {
  for (const path of source?.paths ?? []) {
    const found = text(valueAt(payload, path));
    if (found !== undefined) {
      return found;
    }
  }
  for (const name of source?.env ?? []) {
    const found = text(Object.hasOwn(env, name) ? env[name] : undefined);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
