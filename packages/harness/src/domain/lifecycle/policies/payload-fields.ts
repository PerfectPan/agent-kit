import type { FieldSource } from "../value-objects/hook-dialect.js";
import type { PayloadView } from "../value-objects/payload-view.js";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Reads a key of one of the kit's own records (a dialect's events, a switch's cases) with own properties only, so
 * an event or case named "constructor" finds nothing from `Object.prototype`. Payloads are not read here: the
 * adapter parses them into a `PayloadView` first.
 */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * The first non-empty value among the source's payload paths, then its environment variables. Path values come from
 * the parsed view; the environment is typed, and a variable of the same name on `Object.prototype` cannot be found.
 */
export function readField(payload: PayloadView, env: Env, source: FieldSource | undefined): string | undefined {
  for (const path of source?.paths ?? []) {
    const found = payload.get(path);
    if (found !== undefined && found !== "") {
      return found;
    }
  }
  for (const name of source?.env ?? []) {
    const found = Object.hasOwn(env, name) ? env[name] : undefined;
    if (found !== undefined && found !== "") {
      return found;
    }
  }
  return undefined;
}
