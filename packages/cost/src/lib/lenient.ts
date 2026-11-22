import * as z from "zod/mini";

/** Lenient reading of one external field: an invalid or missing value falls back instead of failing the record. */
export const lenient: <S extends z.core.$ZodType>(schema: S, fallback: z.output<S>) => z.ZodMiniCatch<S> = z.catch;
