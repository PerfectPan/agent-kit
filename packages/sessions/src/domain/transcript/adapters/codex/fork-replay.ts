import { type StampedRecord, timeOf } from "../../index.js";
import { asRecord, asString } from "../record-fields.js";

// A forked or subagent rollout (its first record is a `session_meta` with `forked_from_id` or a `thread_spawn` source)
// starts by copying the parent's records with new timestamps, so record times cannot tell the copy from the rollout's
// own work. Replayed usage and turn durations are the parent's, already counted in its rollout.
//
// The turn ids can: Codex ids are UUIDv7, whose first 48 bits are the creation time in milliseconds, and the copy keeps
// the parent's turn ids. Every copied turn was created before the fork; the rollout's own turns are created after its
// own session id. So when a turn start (`task_started` or `turn_context`) with a UUIDv7 turn id comes before the first
// usage record, the replay ends at the first turn start created at or after the session id (or, when that is not a
// UUIDv7, the `session_meta` timestamp). Otherwise it is found from times: if the first two usage records share a
// second, every record up to the first later one at another second is replay. The rule is decided while reading, so
// the streaming usage decoder and the translator apply it alike; only the first usage record waits for the second.

/** Where a rollout is in its replay, as plain data so a usage cursor can carry it. */
export interface ForkReplayState {
  /**
   * `start`: no record yet. `own`: not a fork, or the replay is over. `open`: a fork before its first turn start or
   * usage record. `turns`: replay until a turn created at or after `forkTime`. `second`: the first usage record was at
   * `second`, and the next one decides. `second-replay`: replay until a record at another second.
   */
  readonly phase: "start" | "own" | "open" | "turns" | "second" | "second-replay";
  readonly forkTime?: number;
  readonly second?: number;
}

export interface ForkReplayStep {
  readonly state: ForkReplayState;
  /** Whether the record is the parent's copy; `undefined` while that is not decided yet. */
  readonly replayed: boolean | undefined;
  /** Set when this record decides about the first usage record, which waited: whether that one was replay. */
  readonly settled?: boolean;
}

export const FORK_REPLAY_START: ForkReplayState = { phase: "start" };

/** Advances the replay rule by one record, with its time in epoch milliseconds. */
export function stepForkReplay(state: ForkReplayState, value: unknown, ts: number): ForkReplayStep {
  const rec = asRecord(value);
  switch (state.phase) {
    case "start": {
      const payload = asRecord(rec?.payload);
      if (rec?.type !== "session_meta" || !isFork(payload)) {
        return { state: { phase: "own" }, replayed: false };
      }
      const forkTime = uuidV7Time(payload?.id) ?? timeOf(payload?.timestamp);
      return { state: forkTime === undefined ? { phase: "open" } : { phase: "open", forkTime }, replayed: undefined };
    }
    case "own":
      return { state, replayed: false };
    case "open": {
      const created = uuidV7Time(turnStartId(rec));
      if (created !== undefined && state.forkTime !== undefined) {
        return created >= state.forkTime
          ? { state: { phase: "own" }, replayed: false }
          : { state: { phase: "turns", forkTime: state.forkTime }, replayed: true };
      }
      if (isUsageRecord(rec)) {
        return { state: { phase: "second", second: secondOf(ts) }, replayed: undefined };
      }
      return { state, replayed: undefined };
    }
    case "turns": {
      const created = uuidV7Time(turnStartId(rec));
      return created !== undefined && created >= (state.forkTime ?? 0)
        ? { state: { phase: "own" }, replayed: false }
        : { state, replayed: true };
    }
    case "second":
      if (!isUsageRecord(rec)) {
        return { state, replayed: undefined };
      }
      return secondOf(ts) === state.second
        ? { state: { phase: "second-replay", second: secondOf(ts) }, replayed: true, settled: true }
        : { state: { phase: "own" }, replayed: false, settled: false };
    case "second-replay":
      return secondOf(ts) === state.second ? { state, replayed: true } : { state: { phase: "own" }, replayed: false };
  }
}

/** The end of the rollout: a first usage record that still waits is the rollout's own, as no second one followed. */
export function endForkReplay(state: ForkReplayState): { readonly state: ForkReplayState; readonly settled?: boolean } {
  return state.phase === "second" ? { state: { phase: "own" }, settled: false } : { state };
}

/** The number of records at the start of a rollout that replay a parent session's history. */
export function forkReplayEnd(stamped: readonly StampedRecord[]): number {
  let state = FORK_REPLAY_START;
  for (const [index, { record, ts }] of stamped.entries()) {
    const step = stepForkReplay(state, record.value, ts);
    if (step.settled === false) {
      return 0;
    }
    if (step.replayed === false) {
      return index;
    }
    state = step.state;
  }
  return state.phase === "turns" || state.phase === "second-replay" ? stamped.length : 0;
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
