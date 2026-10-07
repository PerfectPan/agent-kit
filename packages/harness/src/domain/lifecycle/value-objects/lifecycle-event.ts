import type { CodingAgentId } from "@rivus/agent-kit-catalog";

export type LifecyclePhase = "start" | "activity" | "blocked" | "finish" | "unknown";

/** `session`: the agent opened or closed; `turn`: it started or stopped working on a prompt. */
export type LifecycleScope = "session" | "turn";

export type LifecycleOutcome = "completed" | "failed" | "cancelled";

export type LifecycleBlocker = "permission" | "question" | "elicitation";

export type TerminalHost = "herdr" | "cmux" | "superset" | "tmux";

/** The pane a hook process runs in, kept apart from the agent's session identity. */
export interface TerminalIdentity {
  readonly host: TerminalHost;
  readonly paneId: string;
}

/**
 * One hook payload translated into orthogonal fields. A field the payload does not carry is absent. `subagent` is
 * set when the event describes a subagent, which does not change the main session's state.
 */
export interface LifecycleEvent {
  /** The real source after sniffing: Grok and Cursor also run Claude Code's hooks. */
  readonly agent: CodingAgentId;
  readonly phase: LifecyclePhase;
  readonly scope?: LifecycleScope;
  /** Only on the end of a turn. */
  readonly outcome?: LifecycleOutcome;
  readonly blocker?: LifecycleBlocker;
  /** Orders events across turns, so late events of an older turn can be dropped. */
  readonly turnId?: string;
  readonly subagent?: { readonly id?: string; readonly type?: string };
  /** The tool's name and call id, never its arguments. */
  readonly tool?: { readonly name: string; readonly callId?: string };
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly transcriptPath?: string;
  readonly terminal?: TerminalIdentity;
  /** The event name as the agent sent it; empty when the payload names none. */
  readonly nativeEvent: string;
}

/** The part of a LifecycleEvent that a native event name, and possibly one payload field, determines. */
export interface LifecycleMapping {
  readonly phase: LifecyclePhase;
  readonly scope?: LifecycleScope;
  readonly outcome?: LifecycleOutcome;
  readonly blocker?: LifecycleBlocker;
}
