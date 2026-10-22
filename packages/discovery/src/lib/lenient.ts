import * as z from "zod/mini";

/**
 * Lenient reading of one external field: a value the schema rejects, or a missing one, parses as the fallback
 * instead of failing the whole record. The fallback must match the schema's output type.
 */
export function lenient<S extends z.core.$ZodType>(schema: S, fallback: z.output<S>): z.ZodMiniCatch<S> {
  return z.catch(schema, fallback);
}
