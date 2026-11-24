import { definedFields } from "@rivus/agent-kit-catalog/spi";
import type { Lane, TranscriptEvent } from "@rivus/agent-kit-sessions/spi";
import type { DimRelationValue } from "./rows.js";

// A subagent is a session of its own: the parent's `agent` tool creates it (titled `Subagent <type>`), and a
// `session_relations` row of type `subagent` names the parent, the parent's tool call that started it and the type.
// Discovery lists no such session on its own; load attaches each one the root, or a subagent of it, spawned as a lane.
// A `branch` relation is a user's fork, not a subagent.

/** One subagent lane to attach: the session a parent's relation names, and the parent's tool call that started it. */
export interface DimChildLane {
  readonly sessionId: string;
  readonly sourceSessionId: string;
  readonly parentId: string;
  readonly createdAt: number;
  readonly spawnEventId?: string;
  readonly title?: string;
  readonly forkContext?: string;
}

/** The lane a relation comes from, for resolving a child's `spawnEventId` on it. */
export interface DimLaneParent {
  /** The parent's lane id on the transcript: the agent id for the root, the session id for a subagent. */
  readonly laneId: string;
  /** The `tool_call` event of each call id the parent's assistant messages record. */
  readonly calls: ReadonlyMap<string, TranscriptEvent>;
}

/**
 * The subagent sessions of one transcript walk: a parent's children in spawn order, then their children, each session
 * attached once. A relation naming the root or a session already on the walk is a loop in the records, not another
 * lane: its events are already on the transcript.
 */
export function createDimSubagentQueue(rootId: string): {
  enqueue(relations: readonly DimRelationValue[], parent: DimLaneParent): void;
  next(): DimChildLane | undefined;
} {
  const visited = new Set([rootId]);
  const queue: DimChildLane[] = [];
  return {
    enqueue(relations, parent) {
      for (const relation of relations) {
        if (visited.has(relation.targetSessionId)) {
          continue;
        }
        visited.add(relation.targetSessionId);
        queue.push(
          definedFields({
            sessionId: relation.targetSessionId,
            sourceSessionId: relation.sourceSessionId,
            parentId: parent.laneId,
            createdAt: relation.createdAt,
            spawnEventId: relation.toolCallId === undefined ? undefined : parent.calls.get(relation.toolCallId)?.id,
            title: relation.subagentType,
            forkContext: relation.forkContext
          })
        );
      }
    },
    next: () => queue.shift()
  };
}

/**
 * The sessions `discover` lists: every session but the target of a `subagent` relation from another session, which
 * its parent's transcript carries as a lane. A relation whose source is gone leaves its target listed, and relations
 * that loop name no top-level session, so the smallest session of a loop stays listed.
 */
export function dimTopLevelSessions(sessionIds: Iterable<string>, relations: readonly DimRelationValue[]): Set<string> {
  const known = new Set(sessionIds);
  const parentOf = new Map<string, string>();
  for (const { sourceSessionId, targetSessionId } of relations) {
    if (sourceSessionId !== targetSessionId && known.has(sourceSessionId) && known.has(targetSessionId)) {
      parentOf.set(targetSessionId, sourceSessionId);
    }
  }
  const topLevel = new Set([...known].filter((sessionId) => !parentOf.has(sessionId)));
  const visited = new Set<string>();
  for (const sessionId of known) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let at: string | undefined = sessionId;
    while (at !== undefined && !visited.has(at) && !positions.has(at)) {
      positions.set(at, path.length);
      path.push(at);
      at = parentOf.get(at);
    }
    const loopStart = at === undefined ? undefined : positions.get(at);
    if (loopStart !== undefined) {
      const cycle = path.slice(loopStart).sort();
      if (cycle[0] !== undefined) {
        topLevel.add(cycle[0]);
      }
    }
    path.forEach((id) => visited.add(id));
  }
  return topLevel;
}

/** The lane of an attached subagent session. */
export function dimSubagentLane(child: DimChildLane): Lane {
  return definedFields({
    id: child.sessionId,
    parentId: child.parentId,
    spawnEventId: child.spawnEventId,
    title: child.title
  });
}

/** The lane of a subagent whose session row is gone: the parent's relation records it, but it has no events. */
export function dimUnavailableLane(child: DimChildLane): Lane {
  return { ...dimSubagentLane(child), unavailable: true };
}
