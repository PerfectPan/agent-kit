import * as z from "zod/mini";

import { lenient } from "../../../lib/lenient.js";
import type { Usage } from "../../../domain/usage/value-objects/usage.js";

const SavedUsageSchema = z.looseObject({
  inputTokens: lenient(z.number()),
  outputTokens: lenient(z.number()),
  totalTokens: lenient(z.number()),
  cacheReadTokens: lenient(z.number()),
  cacheWriteTokens: lenient(z.number()),
  cacheWrite1hTokens: lenient(z.number()),
  reasoningTokens: lenient(z.number())
});

/** Parses a plain `Usage`-shaped object leniently without deriving `totalTokens`. */
export function parseSavedUsage(value: unknown): Usage | undefined {
  return z.safeParse(SavedUsageSchema, value).data;
}
