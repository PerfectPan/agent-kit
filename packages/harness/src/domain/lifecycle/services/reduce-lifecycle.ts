import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import type { BlockSource, LifecycleClock, LifecycleState, LifecycleStatus } from "../value-objects/lifecycle-state.js";

const ENDED_TURNS_KEPT = 16;
const MAIN: BlockSource = { kind: "main" };

/** Whether an event from `source` answers the block `open` raised; a subagent without an id matches nothing. */
const answers = (open: BlockSource, source: BlockSource): boolean =>
  open.kind === source.kind &&
  (open.kind === "main" || (source.kind === "subagent" && open.id !== undefined && open.id === source.id));

const unmatchable = (blockers: readonly BlockSource[]): boolean =>
  blockers.some((blocker) => blocker.kind === "subagent" && blocker.id === undefined);

/** Whether an id-less block is past its raise-time TTL; the rule lives on `BlockSource`. */
const expired = (blocker: BlockSource, clock: LifecycleClock): boolean =>
  blocker.kind === "subagent" &&
  blocker.id === undefined &&
  blocker.raisedAt !== undefined &&
  clock.now - blocker.raisedAt > clock.ttlMs;

/** The state with its expired id-less blocks dropped; with none left, the ongoing turn continues as `working`. */
const dropExpired = (state: LifecycleState, clock: LifecycleClock): LifecycleState => {
  if (state.status !== "blocked") {
    return state;
  }
  const raised = state.blockedBy ?? [MAIN];
  const open = raised.filter((blocker) => !expired(blocker, clock));
  if (open.length === raised.length) {
    return state;
  }
  return open.length > 0 ? { ...state, blockedBy: open } : { ...state, status: "working", blockedBy: undefined };
};

/** `blockers` with `source` raised once; an id-less raise re-times the one id-less entry (see `BlockSource`). */
function withBlocker(blockers: readonly BlockSource[], source: BlockSource): readonly BlockSource[] {
  const id = (blocker: BlockSource) => (blocker.kind === "subagent" ? blocker.id : undefined);
  const known = blockers.some((blocker) => blocker.kind === source.kind && id(blocker) === id(source));
  if (!known) {
    return [...blockers, source];
  }
  return source.kind === "subagent" && source.id === undefined
    ? blockers.map((blocker) => (blocker.kind === "subagent" && blocker.id === undefined ? source : blocker))
    : blockers;
}

/** The status at `now`: expired blocks are dropped first, and `working` and `blocked` fall back to `unknown` once no
 * event arrived within the TTL. */
export function lifecycleStatus(state: LifecycleState, clock: LifecycleClock): LifecycleStatus {
  const current = dropExpired(state, clock);
  const busy = current.status === "working" || current.status === "blocked";
  const stale = current.updatedAt === undefined || clock.now - current.updatedAt > clock.ttlMs;
  return busy && stale ? "unknown" : current.status;
}

/**
 * Folds one hook event into a session's state. Hooks lose events (Claude Code sends no `Stop` when the user
 * interrupts; some agents send nothing when a permission prompt is cancelled), so the TTL bounds every busy status.
 *
 * Turn ids are opaque, so order comes from arrival: an event of a turn that already ended or was superseded is
 * late and dropped, and an id not seen before is a new turn. Without turn ids, only a turn start leaves `idle`, so a
 * late tool event cannot reopen a finished turn. A session start only settles an `unknown` or `idle` session: some
 * agents send it without waiting (Cursor), so it can arrive after the first prompt, and Cursor's carries a turn id.
 *
 * Subagent events keep a busy session alive without changing it, with one exception: a subagent's permission
 * request is a prompt the user must answer (Claude Code and Codex fire it when the dialog is about to show), so the
 * session is `blocked`. The state records who raised each open block. Main-agent activity closes only the main
 * agent's own block; a subagent's block closes on a later event of the same subagent (its stop included), or when
 * the main turn starts or finishes. A sibling subagent's activity closes nothing. A subagent without an id (Grok,
 * Cursor) cannot be matched: its block follows the `BlockSource` raise-time rule, and while it is open subagent
 * events do not count as signs of life.
 */
export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent, clock: LifecycleClock): LifecycleState {
  const current: LifecycleState = { ...dropExpired(state, clock), status: lifecycleStatus(state, clock) };
  const { turnId } = event;
  const busy = current.status === "working" || current.status === "blocked";
  if (turnId !== undefined && current.endedTurns.includes(turnId)) {
    return current;
  }
  const open = current.status === "blocked" ? (current.blockedBy ?? [MAIN]) : [];
  if (event.subagent !== undefined) {
    const source: BlockSource =
      event.subagent.id === undefined
        ? { kind: "subagent", raisedAt: clock.now }
        : { kind: "subagent", id: event.subagent.id };
    // An open id-less block's events are not signs of life (see `BlockSource`).
    const alive = unmatchable(open) ? {} : { updatedAt: clock.now };
    if (event.phase === "blocked" && event.blocker === "permission" && current.status !== "idle") {
      return { ...current, status: "blocked", blockedBy: withBlocker(open, source), ...alive };
    }
    if (!busy || event.phase === "unknown") {
      return current;
    }
    const still = event.phase === "blocked" ? open : open.filter((blocker) => !answers(blocker, source));
    if (still.length > 0) {
      return { ...current, blockedBy: still, ...alive };
    }
    const working: LifecycleState = { status: "working", endedTurns: current.endedTurns, updatedAt: clock.now };
    return current.turnId === undefined ? working : { ...working, turnId: current.turnId };
  }

  const newTurn = turnId !== undefined && turnId !== current.turnId;
  const next = (status: LifecycleStatus, turn: string | undefined, ended: readonly (string | undefined)[]) => {
    const fresh = ended.filter((id): id is string => id !== undefined && id !== turn);
    const endedTurns = [...new Set([...current.endedTurns, ...fresh])].slice(-ENDED_TURNS_KEPT);
    const updated: LifecycleState = { status, endedTurns, updatedAt: clock.now };
    return turn === undefined ? updated : { ...updated, turnId: turn };
  };

  switch (event.phase) {
    case "unknown":
      return current;
    case "start":
      if (event.scope === "session") {
        return busy ? current : next("idle", undefined, [current.turnId]);
      }
      return next("working", turnId, [current.turnId]);
    case "activity":
    case "blocked":
      if (current.status === "idle" && !newTurn) {
        return current;
      }
      {
        // A new turn (an unseen turn id) leaves the previous turn's blocks behind; otherwise subagent blocks stay.
        const subagents = newTurn ? [] : open.filter((blocker) => blocker.kind === "subagent");
        const blockedBy = event.phase === "blocked" ? withBlocker(subagents, MAIN) : subagents;
        const turn = next(blockedBy.length > 0 ? "blocked" : "working", turnId ?? current.turnId, [current.turnId]);
        return blockedBy.length > 0 ? { ...turn, blockedBy } : turn;
      }
    case "finish":
      return next("idle", undefined, [current.turnId, turnId]);
  }
}
