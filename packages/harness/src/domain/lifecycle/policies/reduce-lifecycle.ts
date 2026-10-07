import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import type { LifecycleClock, LifecycleState, LifecycleStatus } from "../value-objects/lifecycle-state.js";

const ENDED_TURNS_KEPT = 16;

/** The status at `now`: `working` and `blocked` fall back to `unknown` once no event arrived within the TTL. */
export function lifecycleStatus(state: LifecycleState, clock: LifecycleClock): LifecycleStatus {
  const busy = state.status === "working" || state.status === "blocked";
  const stale = state.updatedAt === undefined || clock.now - state.updatedAt > clock.ttlMs;
  return busy && stale ? "unknown" : state.status;
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
 * session is `blocked` until the subagent, or the session, moves again. A parallel subagent's activity also ends a
 * block the main agent raised itself; the next main event corrects it.
 */
export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent, clock: LifecycleClock): LifecycleState {
  const current: LifecycleState = { ...state, status: lifecycleStatus(state, clock) };
  const { turnId } = event;
  const busy = current.status === "working" || current.status === "blocked";
  if (turnId !== undefined && current.endedTurns.includes(turnId)) {
    return current;
  }
  if (event.subagent !== undefined) {
    if (event.phase === "blocked" && event.blocker === "permission" && current.status !== "idle") {
      return { ...current, status: "blocked", updatedAt: clock.now };
    }
    if (!busy || event.phase === "unknown") {
      return current;
    }
    return { ...current, status: event.phase === "blocked" ? current.status : "working", updatedAt: clock.now };
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
      return next(event.phase === "activity" ? "working" : "blocked", turnId ?? current.turnId, [current.turnId]);
    case "finish":
      return next("idle", undefined, [current.turnId, turnId]);
  }
}
