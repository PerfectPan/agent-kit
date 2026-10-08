/**
 * The turn did not end within the cancel deadline after `session/cancel`. The kit then closed the connection, which
 * also closed its other sessions. For a session with a `sessionKey`, `binding` says what became of its binding:
 * `removed`, `unchanged` (it no longer named this session), or `failed` (the store could not remove it, so a later
 * load may reach a session that is still running the cancelled turn).
 */
export interface CancelUnsettled {
  readonly _tag: "CancelUnsettled";
  readonly sessionId: string;
  readonly sessionKey?: string;
  readonly timeoutMs: number;
  readonly binding?: "removed" | "unchanged" | "failed";
}
