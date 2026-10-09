import * as z from "zod/mini";

/**
 * Lenient reading of one external field: a value the schema rejects, or a missing one, parses as the fallback
 * instead of failing the whole record. The fallback must match the schema's output type.
 */
export function lenient<S extends z.core.$ZodType>(schema: S, fallback: z.output<S>): z.ZodMiniCatch<S> {
  // zod's `catch` wraps a schema with a fallback value; it is not a Promise handler, so the second argument is one.
  // oxlint-disable-next-line promise/valid-params
  return z.catch(schema, fallback);
}
