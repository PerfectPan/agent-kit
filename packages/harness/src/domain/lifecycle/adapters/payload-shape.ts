import * as z from "zod/mini";

import type { FieldPath } from "../value-objects/hook-dialect.js";
import type { PayloadView } from "../value-objects/payload-view.js";
import { lenient } from "./lenient.js";

/**
 * What one payload path may hold: any string, including an empty one, or nothing. A path that is absent or holds
 * another type reads as nothing, so a payload field of an unexpected type counts as absent everywhere.
 */
const Leaf = lenient(z.optional(z.string()), undefined);

/**
 * One level of a path, as the child value it leads to: a record or list holds the key's value only if the key is an
 * own property (an array index is a key too, so Cursor's `workspace_roots.0` reads), and anything else, or an
 * inherited key, reads as nothing. The check neither copies nor walks the level, so a key never finds a prototype
 * member and no getter on another key runs.
 */
const levels = new Map<string, z.ZodMiniType<unknown>>();

function level(key: string): z.ZodMiniType<unknown> {
  let schema = levels.get(key);
  if (schema === undefined) {
    schema = z.transform((value: unknown) =>
      value !== null && typeof value === "object" && Object.hasOwn(value, key)
        ? (value as Readonly<Record<string, unknown>>)[key]
        : undefined
    );
    levels.set(key, schema);
  }
  return schema;
}

const pathKey = (path: FieldPath): string => path.join("\u0000");

/**
 * Reads one payload path: `undefined` as soon as a level is not a record or list, or the leaf is absent or of
 * another type. A value zod's synchronous parse refuses, such as a promise left in a payload field, ends the path;
 * anything else that throws while reading — a throwing getter on the key the path reads, a trapping proxy —
 * propagates. The keys come from a hook dialect, so the descent runs through schemas instead of scattered `typeof`
 * checks.
 */
function readPath(path: FieldPath, payload: unknown): string | undefined {
  try {
    // The level schemas are total transforms: a parse either returns the child value or throws, and only zod's
    // refusal to read a value synchronously is an expected outcome here.
    let value: unknown = payload;
    for (const key of path) {
      value = level(key).safeParse(value).data;
    }
    return Leaf.safeParse(value).data;
  } catch (error) {
    if (error instanceof z.core.$ZodAsyncError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The payload as the dialects read it: each path holds its value on first read, cached, so a path parses once per
 * event however often the dialects return to it.
 */
export function payloadView(payload: unknown): PayloadView {
  const seen = new Map<string, string | undefined>();
  return {
    get(path: FieldPath) {
      const key = pathKey(path);
      if (!seen.has(key)) {
        seen.set(key, readPath(path, payload));
      }
      return seen.get(key);
    }
  };
}
