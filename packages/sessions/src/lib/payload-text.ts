import * as z from "zod/mini";

import { lenient } from "./lenient.js";

/**
 * The text a transcript payload carries, when it is a string: the payload union reads a field back as unknown, and
 * the record adapters write the field as a string or leave it out. The domain services read it through this schema,
 * since the domain layer itself imports no npm package.
 */
export const PayloadText: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniString>> = lenient(z.string());
