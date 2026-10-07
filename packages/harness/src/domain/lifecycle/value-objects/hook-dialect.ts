import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { LifecycleMapping } from "./lifecycle-event.js";

/** Keys from the payload root, such as `["properties", "info", "id"]`; an array index is a key too (`"0"`). */
export type FieldPath = readonly string[];

/** Where one value comes from: the first non-empty payload path, then the first non-empty environment variable. */
export interface FieldSource {
  readonly paths?: readonly FieldPath[];
  readonly env?: readonly string[];
}

/** Where a payload of this agent carries each value a LifecycleEvent needs. */
export interface PayloadFields {
  readonly event: FieldSource;
  readonly sessionId?: FieldSource;
  readonly cwd?: FieldSource;
  readonly transcriptPath?: FieldSource;
  readonly turnId?: FieldSource;
  readonly subagentId?: FieldSource;
  readonly subagentType?: FieldSource;
  /**
   * A value here marks an event as coming from inside a subagent, not only a subagent's own start and stop.
   * Defaults to `subagentId`; a type alone is not enough where the main session can carry one too.
   */
  readonly subagentMarker?: FieldSource;
  readonly toolName?: FieldSource;
  readonly toolCallId?: FieldSource;
}

/** A mapping chosen by one payload field, such as Claude Code's `notification_type`. */
export interface LifecycleSwitch {
  readonly field: FieldPath;
  readonly cases: Readonly<Record<string, LifecycleMapping>>;
  /** Used when the field is missing or has another value. */
  readonly otherwise: LifecycleMapping;
}

/**
 * What the agent does with a command hook's exit code and stdout. `block` stops the operation the event announces
 * (a tool call, a prompt, a stop; on an event that cannot block, exit code 2 only reports stderr); `proceed` lets it
 * continue; `hook-failed` lets it continue and records the hook run as failed.
 */
export interface HookOutput {
  /** Exit code 0 with nothing on stdout. */
  readonly emptyStdout: "proceed" | "block" | "undocumented";
  /** Exit code 0 with stdout that is not JSON, or JSON the event does not accept. */
  readonly invalidStdout: "proceed" | "block" | "hook-failed" | "undocumented";
  /**
   * Exit code 0 with plain text on stdout, where the text does more than `invalidStdout` says: `context` adds it to
   * the model's context and `shown` shows it to the user. An observer must print nothing, or JSON, there.
   */
  readonly plainStdout?: "context" | "shown";
  readonly exitCode2: "proceed" | "block" | "undocumented";
  readonly otherExitCodes: "proceed" | "block" | "hook-failed" | "undocumented";
  /** Top-level JSON fields the event accepts on stdout. */
  readonly fields?: readonly string[];
  /** What a hook that only observes prints, on every path, so that the operation proceeds unchanged. */
  readonly passThrough: string;
  /** What the agent's documentation does not confirm: it is silent, or the agent's source behaves differently. */
  readonly unverified?: string;
}

export interface HookEventSpec {
  /** Phase `unknown` only on a gate kept for its response rules, such as Cursor's tab-completion file read. */
  readonly lifecycle: LifecycleMapping | LifecycleSwitch;
  /** Other spellings of this event in payloads, such as Grok's snake_case wire names. */
  readonly aliases?: readonly string[];
  /** The event is a subagent's own start or stop. */
  readonly subagent?: true;
  /** A permission gate: the hook's response decides whether the operation proceeds. */
  readonly gate?: true;
  /** How this event reads exit codes and stdout, when that differs from the dialect's `output`. */
  readonly output?: HookOutput;
  readonly unverified?: string;
}

export interface HookTimeout {
  readonly unit: "seconds" | "milliseconds";
  /** The agent's default, in `unit`. */
  readonly default?: number;
  readonly unverified?: string;
}

/** Another agent's hook configuration that this agent also runs, and how it renames that agent's events. */
export interface ForeignHooks {
  readonly agent: CodingAgentId;
  /** Configuration files; a `~/` path is under the user's home, any other path is relative to the project root. */
  readonly files: readonly string[];
  /** Whether this happens without the user turning it on. */
  readonly byDefault: boolean;
  /** Foreign event name → this agent's event name. A foreign event missing here never fires in this agent. */
  readonly events: Readonly<Record<string, string>>;
  readonly unverified?: string;
}

/**
 * One agent's hook facts: the only place they are kept. Hook installation generates registrations from it (event
 * names, timeout unit, what an observer prints), and `readHookEvent` reads payloads with it.
 */
export interface HookDialect {
  readonly specificationVersion: "harness-v1";
  readonly agent: CodingAgentId;
  /**
   * `command`: the agent runs a command with the payload as JSON on stdin and reads its exit code and stdout.
   * `plugin`: the agent calls an in-process plugin, which forwards each event's object as the payload.
   */
  readonly delivery: "command" | "plugin";
  /** Absent for plugin delivery, which has no hook timeout. */
  readonly timeout?: HookTimeout;
  readonly fields: PayloadFields;
  /** Native event name → its meaning. Events missing here read as phase `unknown`. */
  readonly events: Readonly<Record<string, HookEventSpec>>;
  /** How command hooks' exit codes and stdout are read, unless an event overrides it. */
  readonly output?: HookOutput;
  /**
   * `content-hash`: each new or changed hook definition waits for the user's review, so a command that embeds a
   * version asks again after every upgrade. `workspace`: hooks run once their folder is trusted, with no per-hook
   * review.
   */
  readonly trust?: { readonly review: "content-hash" | "workspace"; readonly unverified?: string };
  readonly runsHooksOf?: readonly ForeignHooks[];
}

/** Hook dialects by agent id; `readHookEvent` defaults to `builtinHookDialects`. */
export type HookDialects = Readonly<Partial<Record<CodingAgentId, HookDialect>>>;
