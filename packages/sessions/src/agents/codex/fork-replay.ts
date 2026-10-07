import { type StampedRecord, timeOf } from "../../domain/transcript/index.js";
import { asRecord, asString } from "../record-fields.js";

/**
 * The number of records at the start of a rollout that replay a parent session's history. A forked or subagent
 * rollout (its `session_meta` has `forked_from_id` or a `thread_spawn` source) starts by copying the parent's records
 * with new timestamps, so record times cannot tell the copy from the rollout's own work.
 *
 * The turn ids can: Codex ids are UUIDv7, whose first 48 bits are the creation time in milliseconds, and the copy
 * keeps the parent's turn ids. Every copied turn was created before the fork; the rollout's own turns are created
 * after its own session id. So the replay ends at the first `task_started` or `turn_context` whose turn id was created
 * at or after the session id (or, when that is not a UUIDv7, the `session_meta` timestamp). When the turn ids are not
 * UUIDv7, the replay is found from times: if the first two usage records share a second, every record up to the first
 * later one at another second. Replayed usage and turn durations are the parent's, already counted in its rollout.
 */
export function forkReplayEnd(stamped: readonly StampedRecord[]): number {
  const meta = asRecord(stamped.find(({ record }) => asRecord(record.value)?.type === "session_meta")?.record.value);
  const payload = asRecord(meta?.payload);
  if (!isFork(payload)) {
    return 0;
  }
  const forkTime = uuidV7Time(payload?.id) ?? timeOf(payload?.timestamp);
  let turnIds = false;
  for (const [index, { record }] of stamped.entries()) {
    const created = uuidV7Time(turnStartId(asRecord(record.value)));
    if (created === undefined) {
      continue;
    }
    turnIds = true;
    if (forkTime !== undefined && created >= forkTime) {
      return index;
    }
  }
  if (turnIds && forkTime !== undefined) {
    // Every turn is the parent's: the rollout has not started one of its own.
    return stamped.length;
  }
  return sameSecondReplayEnd(stamped);
}

function isFork(meta: Record<string, unknown> | undefined): boolean {
  return (
    typeof meta?.forked_from_id === "string" || asRecord(asRecord(meta?.source)?.subagent)?.thread_spawn !== undefined
  );
}

/** The turn id of a record that starts a turn: `event_msg` `task_started`, or `turn_context`. */
function turnStartId(rec: Record<string, unknown> | undefined): unknown {
  const payload = asRecord(rec?.payload);
  const starts = rec?.type === "turn_context" || (rec?.type === "event_msg" && payload?.type === "task_started");
  return starts ? payload?.turn_id : undefined;
}

const UUID_V7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

/** The creation time in epoch milliseconds that a UUIDv7 carries in its first 48 bits. */
function uuidV7Time(value: unknown): number | undefined {
  const id = asString(value);
  return id !== undefined && UUID_V7.test(id) ? Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16) : undefined;
}

function sameSecondReplayEnd(stamped: readonly StampedRecord[]): number {
  const usage: number[] = [];
  for (let index = 0; index < stamped.length && usage.length < 2; index++) {
    if (isUsageRecord(asRecord(stamped[index]!.record.value))) {
      usage.push(index);
    }
  }
  const [first, second] = usage;
  if (first === undefined || second === undefined) {
    return 0;
  }
  const replaySecond = secondOf(stamped[first]!.ts);
  if (secondOf(stamped[second]!.ts) !== replaySecond) {
    return 0;
  }
  for (let index = second + 1; index < stamped.length; index++) {
    if (secondOf(stamped[index]!.ts) !== replaySecond) {
      return index;
    }
  }
  return stamped.length;
}

function isUsageRecord(rec: Record<string, unknown> | undefined): boolean {
  if (rec?.type === "token_usage_record") {
    return true;
  }
  const payload = asRecord(rec?.payload);
  return rec?.type === "event_msg" && payload?.type === "token_count" && asRecord(payload.info) !== undefined;
}

function secondOf(ts: number): number {
  return Math.floor(ts / 1000);
}
