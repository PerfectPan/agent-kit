import * as z from "zod/mini";

import { timeOf } from "../index.js";
import { lenient } from "./lenient.js";

/**
 * A record's own time as agent logs write it: a timestamp string, or epoch seconds or milliseconds as a number. ISO
 * text is what logs mostly carry, so the union tries the string first. Read leniently like every agent log, and
 * shared by every adapter's record schema; `timeOf` turns it into epoch ms.
 */
export const logTimestamp: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniUnion<[z.ZodMiniString, z.ZodMiniNumber]>>> =
  lenient(z.union([z.string(), z.number()]));

/**
 * The fields of a record whose time alone a reader needs: the `timestamp` the log wrote. Strip mode keeps the read to
 * that one field — a loose object would copy every key of every record.
 */
const timestampedRecord = z.object({ timestamp: logTimestamp });

/** The time a raw record value carries in its `timestamp` field, in epoch milliseconds. */
export function timeOfValue(value: unknown): number | undefined {
  return timeOf(z.safeParse(timestampedRecord, value).data?.timestamp);
}
