import { isPlainObject } from "es-toolkit";

// Agent logs are read leniently: a field of an unexpected type counts as absent, and only the record envelope
// decides whether the format generation is known. These accessors are that rule; they are not a schema.

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
