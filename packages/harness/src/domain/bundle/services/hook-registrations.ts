import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { ForeignHooks, HookDialect, HookDialects } from "../../lifecycle/value-objects/hook-dialect.js";
import type { HookSpec } from "../value-objects/artifact-spec.js";

/** One hook as an agent's configuration registers it. */
export interface HookRegistration {
  readonly event: string;
  readonly command: string;
  /** In the dialect's timeout unit; absent when the spec sets none or the agent delivers events to a plugin. */
  readonly timeout?: number;
}

export interface HookSpecRejected {
  readonly _tag: "HookSpecRejected";
  readonly agent: CodingAgentId;
  readonly event: string;
  /**
   * `unknown-event`: not an event of the agent's dialect. `blocking-gate`: a permission gate where a hook that exits
   * 0 without output does not let the operation proceed, so an observer must not be registered there.
   */
  readonly reason: "unknown-event" | "blocking-gate";
  /** Set when the blocking gate is another agent's: that agent and the event it runs the registration as. */
  readonly runBy?: { readonly agent: CodingAgentId; readonly event: string };
}

export interface HookRegistrationOptions {
  /**
   * The dialects of other agents that also run hooks registered where these go, such as Cursor and Grok for Claude
   * Code's settings file (see `runnersOf`). A registration must also be safe as the event each of them runs it as.
   */
  readonly runBy?: readonly HookDialect[];
}

/**
 * Whether a runner loads another agent's hooks, as the application read it from the runner's settings, such as Grok's
 * `[compat.claude] hooks = false`.
 */
export interface HookCompat {
  readonly runner: CodingAgentId;
  readonly agent: CodingAgentId;
  readonly enabled: boolean;
}

/**
 * How `runner` renames the hooks of `agent` registered in `file` (written as in `ForeignHooks.files`), or `undefined`
 * when it does not run them: the application's `compat` reading decides, otherwise `ForeignHooks.byDefault`. Only
 * de-duplication relies on this; the gate check uses `runnersOf`.
 */
export function foreignHooksIn(
  runner: HookDialect,
  agent: CodingAgentId,
  file: string,
  compat: readonly HookCompat[] = []
): ForeignHooks | undefined {
  const foreign = runner.runsHooksOf?.find((hooks) => hooks.agent === agent && hooks.files.includes(file));
  const setting = compat.find((entry) => entry.runner === runner.agent && entry.agent === agent);
  return foreign !== undefined && (setting?.enabled ?? foreign.byDefault) ? foreign : undefined;
}

/**
 * The dialects that could run `agent`'s hooks registered in `file`, whatever their settings say: the gate check covers
 * them all, because a runner turned off now can be turned on without a new plan (and some always load them).
 */
export function runnersOf(agent: CodingAgentId, file: string, dialects: HookDialects): readonly HookDialect[] {
  return Object.values(dialects).filter(
    (dialect): dialect is HookDialect =>
      dialect?.runsHooksOf?.some((hooks) => hooks.agent === agent && hooks.files.includes(file)) === true
  );
}

/** An event of the dialect that is a permission gate where a hook exiting 0 without output does not let it proceed. */
function blocksOnSilence(dialect: HookDialect, event: string): boolean {
  const spec = Object.hasOwn(dialect.events, event) ? dialect.events[event] : undefined;
  return spec?.gate === true && (spec.output ?? dialect.output)?.emptyStdout !== "proceed";
}

/**
 * The registrations of a hook spec for one agent, in that agent's event names and timeout unit. An observer is
 * refused on a gate where silence blocks, in this agent or in any agent of `options.runBy` that renames the event to
 * such a gate (agent-presence#89: Claude Code's PreToolUse in its settings file is Cursor's preToolUse gate).
 */
export function hookRegistrations(
  spec: HookSpec,
  dialect: HookDialect,
  options: HookRegistrationOptions = {}
): Result<readonly HookRegistration[], HookSpecRejected> {
  const events = Object.hasOwn(spec.events, dialect.agent) ? (spec.events[dialect.agent] ?? []) : [];
  const timeout =
    spec.timeoutSeconds === undefined || dialect.delivery === "plugin"
      ? undefined
      : dialect.timeout?.unit === "milliseconds"
        ? spec.timeoutSeconds * 1000
        : spec.timeoutSeconds;
  const registrations: HookRegistration[] = [];
  for (const event of events) {
    const eventSpec = Object.hasOwn(dialect.events, event) ? dialect.events[event] : undefined;
    if (eventSpec === undefined) {
      return err({ _tag: "HookSpecRejected", agent: dialect.agent, event, reason: "unknown-event" });
    }
    if (blocksOnSilence(dialect, event)) {
      return err({ _tag: "HookSpecRejected", agent: dialect.agent, event, reason: "blocking-gate" });
    }
    for (const runner of options.runBy ?? []) {
      for (const foreign of runner.runsHooksOf ?? []) {
        const renamed =
          foreign.agent === dialect.agent && Object.hasOwn(foreign.events, event) ? foreign.events[event] : undefined;
        if (renamed !== undefined && blocksOnSilence(runner, renamed)) {
          return err({
            _tag: "HookSpecRejected",
            agent: dialect.agent,
            event,
            reason: "blocking-gate",
            runBy: { agent: runner.agent, event: renamed }
          });
        }
      }
    }
    registrations.push(
      timeout === undefined ? { event, command: spec.command } : { event, command: spec.command, timeout }
    );
  }
  return ok(registrations);
}
