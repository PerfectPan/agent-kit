import type { DetectionStatus } from "../value-objects/detection-status.js";
import type { AuthObservation, AuthReading, AuthState } from "../value-objects/auth-state.js";

/** The reading of a source that was only checked for existence, which `resolveAuthState` decides by. */
const PRESENT: AuthReading = { loggedIn: true };

/**
 * Combines login observations: the agent's status command decides when it answered; otherwise a stored credential or
 * an authenticating variable counts as logged in. An observation without a reading is a source that was only checked
 * for existence — a credential file the recipe does not parse — and counts as logged in too. A credential source that
 * says `loggedIn: false` is not evidence of being logged out, so only a command can produce `logged-out`.
 */
export function resolveAuthState(observations: readonly AuthObservation[]): AuthState {
  const command = observations.find((observation) => observation.source.kind === "command");
  const decisive = command ?? observations.find((observation) => (observation.reading ?? PRESENT).loggedIn);
  if (decisive === undefined) {
    return { status: "unknown" };
  }
  const { source, reading } = decisive;
  const answer = reading ?? PRESENT;
  if (!answer.loggedIn) {
    return { status: "logged-out", source };
  }
  return answer.method === undefined
    ? { status: "logged-in", source }
    : { status: "logged-in", method: answer.method, source };
}

/** The reading of an authenticating variable with a non-blank value, which stands for the login method it names. */
export function envReading(method: string | undefined): AuthReading {
  return method === undefined ? { loggedIn: true } : { loggedIn: true, method };
}

/** Whether detection reads an installation's login state: one that is not present has none. */
export function probesAuth(status: DetectionStatus): boolean {
  return status === "runnable" || status === "found";
}
