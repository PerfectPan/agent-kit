/** A snapshot that breaks the session's invariants, such as a turn state without a session id. */
export interface AcpSessionInvalid {
  readonly _tag: "AcpSessionInvalid";
  readonly message: string;
}
