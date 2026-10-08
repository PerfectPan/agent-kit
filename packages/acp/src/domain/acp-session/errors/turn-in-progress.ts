/** A prompt was sent while the session's previous turn is still running. A session runs one turn at a time. */
export interface TurnInProgress {
  readonly _tag: "TurnInProgress";
  readonly sessionId: string;
  readonly turn: number;
}
