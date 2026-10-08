export interface SessionOpened {
  readonly _tag: "SessionOpened";
  readonly sessionId: string;
}

export interface TurnStarted {
  readonly _tag: "TurnStarted";
  readonly sessionId: string;
  readonly turn: number;
}

export interface CancelRequested {
  readonly _tag: "CancelRequested";
  readonly sessionId: string;
  readonly turn: number;
}

export interface TurnFinished {
  readonly _tag: "TurnFinished";
  readonly sessionId: string;
  readonly turn: number;
  /** ACP's stop reason, or `error` when the prompt request failed. */
  readonly finishReason: string;
}

/** The session's binding must be removed: the agent may still be running a turn the caller gave up on. */
export interface BindingInvalidated {
  readonly _tag: "BindingInvalidated";
  readonly sessionId: string;
  readonly sessionKey?: string;
}

export interface SessionEnded {
  readonly _tag: "SessionEnded";
  readonly sessionId?: string;
  readonly reason: "closed" | "connection-closed" | "cancel-unsettled";
}

export type AcpSessionEvent =
  | SessionOpened
  | TurnStarted
  | CancelRequested
  | TurnFinished
  | BindingInvalidated
  | SessionEnded;
