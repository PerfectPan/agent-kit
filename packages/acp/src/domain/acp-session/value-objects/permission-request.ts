export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  readonly optionId: string;
  readonly name: string;
  readonly kind: PermissionOptionKind;
}

/**
 * The agent asking the caller to allow an action during a turn. `toolCall` holds what the agent said about the call:
 * `callId` always, and `title`, `kind` and `rawInput` when it sent them.
 */
export interface PermissionRequest {
  readonly sessionId: string;
  readonly sessionKey?: string;
  readonly toolCall: {
    readonly callId: string;
    readonly title?: string;
    readonly kind?: string;
    readonly rawInput?: unknown;
  };
  readonly options: readonly PermissionOption[];
}

/**
 * The caller's answer: one of the request's options by id. An id the request did not offer counts as no answer, and
 * no answer is a denial.
 */
export interface PermissionDecision {
  readonly optionId: string;
}

/** What the agent receives: the selected option, or `cancelled` when the turn is being cancelled. */
export type PermissionOutcome =
  | { readonly outcome: "selected"; readonly optionId: string }
  | { readonly outcome: "cancelled" };
