import { definedFields, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  type JsonlRecords,
  type Lane,
  readJsonlRecords,
  type SessionPlatform,
  type SessionReadError
} from "@rivus/agent-kit-sessions/spi";
import { AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL } from "../facts.js";
import { agyRelayedMessageSender, agyStepOf } from "../records.js";
import type { AgySpawn } from "./events.js";

// A subagent is a conversation of its own: the parent's `invoke_subagent` tool result names its conversation id, and
// the conversation writes the same transcript layout under the same brain root. Its first record is the message the
// parent sent to spawn it, so `discover` lists it as no session of its own; `load` attaches it as a lane.

/** One subagent lane to attach: the conversation a parent lane's `invoke_subagent` result created. */
export interface AgyChildLane {
  readonly conversationId: string;
  readonly parentId: string;
  readonly spawnEventId: string;
  readonly title?: string;
}

/**
 * The subagent conversations of one transcript walk: a parent's children in spawn order, then their children, each
 * conversation attached once. A spawn naming the root or a conversation already on the walk is a loop in the
 * records, not another lane: its events are already on the transcript.
 */
export function createAgySpawnQueue(rootId: string): {
  enqueue(spawns: ReadonlyMap<string, AgySpawn>, parentId: string): void;
  next(): AgyChildLane | undefined;
} {
  const visited = new Set([rootId]);
  const queue: AgyChildLane[] = [];
  return {
    enqueue(spawns, parentId) {
      for (const [conversationId, spawn] of spawns) {
        if (visited.has(conversationId)) {
          continue;
        }
        visited.add(conversationId);
        queue.push({
          conversationId,
          parentId,
          spawnEventId: spawn.spawnEventId,
          ...(spawn.title === undefined ? {} : { title: spawn.title })
        });
      }
    },
    next: () => queue.shift()
  };
}

/**
 * The transcript file of one conversation under a brain root: `transcript_full.jsonl` when present, else
 * `transcript.jsonl`; `undefined` when the conversation has neither. A stat that fails other than by abort leaves
 * the file unfound: the lane is then `unavailable`, and the parent's transcript still loads.
 */
export async function agyTranscriptPath(
  platform: SessionPlatform,
  conversationDir: string,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  for (const transcript of [AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL]) {
    const path = `${conversationDir}/${transcript}`;
    const info = await platform.fs.stat(path, { followSymlinks: true }).catch(() => {
      signal?.throwIfAborted();
      return undefined;
    });
    if (info?.kind === "file") {
      return path;
    }
  }
  return undefined;
}

/** The lane of an attached subagent conversation. */
export function agyLane(lane: AgyChildLane): Lane {
  return definedFields({
    id: lane.conversationId,
    parentId: lane.parentId,
    spawnEventId: lane.spawnEventId,
    title: lane.title
  });
}

/** The lane of a subagent conversation whose transcript is missing or could not be read. */
export function agyUnavailableLane(lane: AgyChildLane): Lane {
  return { ...agyLane(lane), unavailable: true };
}

/** One subagent conversation's transcript; a missing or unreadable file is a failure value, an abort rejects. */
export function readAgyLaneRecords(
  platform: SessionPlatform,
  path: string,
  signal: AbortSignal | undefined
): Promise<Result<JsonlRecords, SessionReadError>> {
  return catchIoFailure(platform, path, signal, (guarded) =>
    readJsonlRecords(guarded, path, definedFields({ signal }))
  );
}

/**
 * Whether a conversation's first record is the message another conversation sent to spawn it, which makes the
 * conversation a subagent rather than a session of its own.
 */
export function agyIsSpawnedConversation(first: Record<string, unknown> | undefined, conversationId: string): boolean {
  const step = first === undefined ? undefined : agyStepOf(first);
  if (step?.type !== "SYSTEM_MESSAGE") {
    return false;
  }
  const sender = agyRelayedMessageSender(step.content ?? "");
  return sender !== undefined && sender !== conversationId;
}
