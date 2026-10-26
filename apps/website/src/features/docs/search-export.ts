/** Narrow Fumadocs' `export()` result to the per-locale map from `localeMap`. */
export function i18nSearchData(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "i18n" ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    Array.isArray(value.data)
  ) {
    const kind = typeof value === "object" && value !== null && "type" in value ? String(value.type) : typeof value;
    throw new Error(`expected per-language search export, got ${kind}`);
  }
  return value.data as Record<string, unknown>;
}
