// Agent logs are read leniently: a field of an unexpected type counts as absent, and only the record envelope
// decides whether the format generation is known. These accessors are that rule; they are not a schema. They use
// `typeof` checks rather than a library because `/transcript/usage` bundles them and must import nothing: a host
// that cannot install dependencies loads that entry on its own.

/** A JSON object. Arrays and `null` are not records. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
