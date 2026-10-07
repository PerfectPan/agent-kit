import type { AuthObservation, AuthState } from "../value-objects/auth-state.js";

/**
 * Combines login observations: the agent's status command decides when it answered; otherwise a stored credential or
 * an authenticating variable counts as logged in. A credential source that says `loggedIn: false` is not evidence
 * of being logged out, so only a command can produce `logged-out`.
 */
export function resolveAuthState(observations: readonly AuthObservation[]): AuthState {
  const command = observations.find((observation) => observation.source.kind === "command");
  const decisive = command ?? observations.find((observation) => observation.reading.loggedIn);
  if (decisive === undefined) {
    return { status: "unknown" };
  }
  const { source, reading } = decisive;
  if (!reading.loggedIn) {
    return { status: "logged-out", source };
  }
  return reading.method === undefined
    ? { status: "logged-in", source }
    : { status: "logged-in", method: reading.method, source };
}
