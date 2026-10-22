/**
 * Reads only own properties so keys such as "constructor" cannot return inherited prototype values.
 * The caller supplies an already validated record; this helper does not validate unknown input.
 */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
