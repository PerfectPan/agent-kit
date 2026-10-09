import * as z from "zod/mini";

import type { FieldPath, HookDialect } from "../value-objects/hook-dialect.js";
import type { PayloadView } from "../value-objects/payload-view.js";

/**
 * What one payload path may hold: any string, including an empty one, or nothing. A path that is absent or holds
 * another type reads as nothing, so a payload field of an unexpected type counts as absent everywhere.
 */
const Leaf = z.catch(z.optional(z.string()), undefined);

/**
 * One level of a path, as the child value it leads to: a record reads the key's value, a list reads the index the
 * key names (`"0"`; Cursor's payload carries the working directory as `workspace_roots.0`), and anything else ends
 * the path. A key that is absent reads as nothing, and the parsed level is a fresh value, so no key finds a
 * prototype member.
 */
const level = (key: string): z.ZodMiniType<unknown> =>
  z.union([
    z.pipe(
      z.looseObject({ [key]: z.unknown() }),
      z.transform((record: Readonly<Record<string, unknown>>) => record[key])
    ),
    z.pipe(
      z.array(z.unknown()),
      z.transform((list) => (Object.hasOwn(list, key) ? list[Number(key)] : undefined))
    )
  ]);

const pathKey = (path: FieldPath): string => path.join("\u0000");

/**
 * Reads one payload path, whose levels and leaf are the schemas above: `undefined` as soon as a level is neither a
 * record nor a list, or the leaf is absent or of another type. The keys come from a hook dialect, so the descent
 * runs through schemas instead of `typeof` checks.
 */
function readPath(path: FieldPath, payload: unknown): string | undefined {
  let value: unknown = payload;
  for (const key of path) {
    const step = level(key).safeParse(value);
    if (!step.success) {
      return undefined;
    }
    value = step.data;
  }
  return Leaf.safeParse(value).data;
}

/** The fixed paths host sniffing reads, whichever dialect is declared: Grok's and Cursor's evidence fields. */
export const SNIFF_PATHS: readonly FieldPath[] = [["hookEventName"], ["cursor_version"]];

/**
 * Every path a dialect reads: its fields', and the switch field of each event whose mapping is chosen by the
 * payload. Deduplicated, since several fields may share one path.
 */
export function dialectPaths(dialect: HookDialect): readonly FieldPath[] {
  const paths = new Map<string, FieldPath>();
  const addPaths = (pathsOf: readonly FieldPath[]) => {
    for (const path of pathsOf) {
      paths.set(pathKey(path), path);
    }
  };
  for (const key of [
    "event",
    "sessionId",
    "cwd",
    "transcriptPath",
    "turnId",
    "subagentId",
    "subagentType",
    "subagentMarker",
    "toolName",
    "toolCallId"
  ] as const) {
    addPaths(dialect.fields[key]?.paths ?? []);
  }
  for (const spec of Object.values(dialect.events)) {
    if ("cases" in spec.lifecycle) {
      addPaths([spec.lifecycle.field]);
    }
  }
  return [...paths.values()];
}

/** The payload as this set of paths reads it, each path parsed once. */
export function payloadView(paths: readonly FieldPath[], payload: unknown): PayloadView {
  const values = new Map<string, string | undefined>();
  for (const path of paths) {
    values.set(pathKey(path), readPath(path, payload));
  }
  return { get: (path) => values.get(pathKey(path)) };
}
