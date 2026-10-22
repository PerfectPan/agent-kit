import type { FieldSource } from "../spi/hook-dialect.js";
import type { PayloadView } from "../value-objects/payload-view.js";

export type Env = Readonly<Record<string, string | undefined>>;

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
