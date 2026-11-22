import { definedFields } from "@rivus/agent-kit-catalog/public";
import * as z from "zod/mini";

import { lenient } from "../../../lib/lenient.js";
import { type CompactionPayload } from "../../../domain/transcript/value-objects/transcript-event.js";

const Span = z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) });
const TokenCount = z.number().check(z.nonnegative());

const PartData = z.looseObject({
  type: z.string(),
  text: lenient(z.string()),
  tool: lenient(z.string()),
  callID: lenient(z.string()),
  auto: lenient(z.boolean()),
  trigger: lenient(z.string()),
  operationId: lenient(z.string()),
  timelineStatus: lenient(z.string()),
  preCompactTokenCount: lenient(TokenCount),
  compactBoundary: lenient(
    z.object({
      trigger: lenient(z.string()),
      preCompactTokenCount: lenient(TokenCount)
    })
  ),
  state: lenient(
    z.looseObject({
      status: lenient(z.string()),
      input: lenient(z.unknown()),
      output: lenient(z.unknown()),
      error: lenient(z.unknown()),
      time: lenient(Span)
    })
  ),
  time: lenient(Span)
});

/** A stored `part` row's JSON as the reader uses it; every agent of this layout writes the same shape. */
export interface SqliteSessionPart {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  auto?: boolean;
  trigger?: string;
  operationId?: string;
  timelineStatus?: string;
  preCompactTokenCount?: number;
  compactBoundary?: { trigger?: string; preCompactTokenCount?: number };
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    time?: { start?: number; end?: number };
  };
  time?: { start?: number; end?: number };
}

/** The part row's JSON `value`, or `undefined` when it is not a part record. */
export function partOf(value: unknown): SqliteSessionPart | undefined {
  return z.safeParse(PartData, value).data;
}

/** One compaction a session's parts name, kept until the walk selects one per operation. */
export interface Compaction {
  rowid: number;
  priority: number;
  payload: CompactionPayload;
}

function compactionTrigger(part: SqliteSessionPart): CompactionPayload["trigger"] {
  const trigger = part.compactBoundary?.trigger || part.trigger;
  if (trigger === "auto" || trigger === "reactive") {
    return "auto";
  }
  if (trigger === "manual") {
    return "manual";
  }
  if (trigger) {
    return undefined;
  }
  return part.auto === undefined ? undefined : part.auto ? "auto" : "manual";
}

/** A user boundary is authoritative when the same operation also has an assistant timeline mirror. */
export function rememberCompaction(
  compactions: Map<string, Compaction>,
  part: SqliteSessionPart,
  role: string,
  rowid: number
): CompactionPayload | undefined {
  if (part.timelineStatus !== undefined && part.timelineStatus !== "completed") {
    return undefined;
  }
  const payload: CompactionPayload = definedFields({
    trigger: compactionTrigger(part),
    preTokens: part.compactBoundary?.preCompactTokenCount ?? part.preCompactTokenCount
  });
  const key = part.operationId ? `operation:${part.operationId}` : `row:${rowid}`;
  const priority =
    part.compactBoundary !== undefined ? 3 : role === "user" ? 2 : part.timelineStatus === undefined ? 1 : 0;
  const previous = compactions.get(key);
  if (previous === undefined || priority > previous.priority) {
    compactions.set(key, { rowid, priority, payload });
  }
  return payload;
}
