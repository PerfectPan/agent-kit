/**
 * Reads a key of one of the kit's own records (a dialect's events, a switch's cases) with own properties only, so
 * an event or case named "constructor" finds nothing from `Object.prototype`. Payloads are not read here: the
 * adapter parses them into a `PayloadView` first.
 */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
