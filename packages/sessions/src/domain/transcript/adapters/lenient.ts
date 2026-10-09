import * as z from "zod/mini";

/**
 * Agent logs are read leniently: a field of an unexpected type counts as absent, and only the record envelope decides
 * whether the format generation is known. `lenient` is that rule for one field: the field may be missing, and a value
 * the schema rejects parses as absent instead of failing the record. A list is one value: `lenient(z.array(s))`
 * drops the whole array when one element fails. Per-element leniency is `z.array(lenient(s))` plus dropping the
 * `undefined`s, as the opencode settlement's cursor state does.
 */
export function lenient<S extends z.core.$ZodType>(schema: S): z.ZodMiniCatch<z.ZodMiniOptional<S>> {
  // zod's `catch` wraps a schema with a fallback value; it is not a Promise handler, so the second argument is one.
  // oxlint-disable-next-line promise/valid-params
  return z.catch(z.optional(schema), undefined);
}
