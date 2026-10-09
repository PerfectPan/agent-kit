import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  type ForeignHooks,
  type HookDialect,
  type HookDialects,
  foreignHooksOf
} from "../../lifecycle/value-objects/hook-dialect.js";
import type { HookSource, InstallAdapters, InstallContext } from "../value-objects/install-adapter.js";
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
  const foreign = foreignHooksOf(runner).find((hooks) => hooks.agent === agent && hooks.files.includes(file));
  const setting = compat.find((entry) => entry.runner === runner.agent && entry.agent === agent);
  return foreign !== undefined && (setting?.enabled ?? foreign.byDefault) ? foreign : undefined;
}

/**
 * The dialects that could run `agent`'s hooks registered in `file`, whatever their settings say: the gate check covers
 * them all, because a runner turned off now can be turned on without a new plan (and some always load them).
 */
export function runnersOf(agent: CodingAgentId, file: string, dialects: HookDialects): readonly HookDialect[] {
  return Object.values(dialects).filter((dialect): dialect is HookDialect =>
    foreignHooksOf(dialect).some((hooks) => hooks.agent === agent && hooks.files.includes(file))
  );
}

/** A foreign hook file one runner executes: the owner's file, its storage shape, and the runner's event renames. */
export interface ForeignHookFile {
  /** The agent whose hooks live in the file. */
  readonly owner: CodingAgentId;
  /** Absolute path under the home (`~/` files are the only ones the kit can resolve across agents). */
  readonly path: string;
  /** How the owner stores hooks in that file, taken from its own hook sources. */
  readonly source: HookSource;
  /** Owner event name → the runner's event name. An owner event missing here never fires in the runner. */
  readonly rename: Readonly<Record<string, string>>;
}

/**
 * Every other agent's hook file that `runner` executes and the kit can resolve, as one rule for planning and
 * diagnostics: each `runsHooksOf` file under `~/` that the runner actually loads (its `byDefault`, unless a read
 * `compat` setting says otherwise), matched to the owner agent's own hook source; when the owner does not list that
 * exact file, its first known source supplies the storage format and layout (an agent reads the same shape from a file
 * its current adapter no longer names, such as Claude Code's `settings.local.json`).
 */
export function foreignHookFiles(
  runner: CodingAgentId,
  dialects: HookDialects,
  adapters: InstallAdapters,
  context: InstallContext,
  compat: readonly HookCompat[] = []
): readonly ForeignHookFile[] {
  const dialect = Object.hasOwn(dialects, runner) ? dialects[runner] : undefined;
  if (dialect === undefined) {
    return [];
  }
  const files: ForeignHookFile[] = [];
  for (const foreign of foreignHooksOf(dialect)) {
    const known = adapters[foreign.agent]?.hookSources?.(context) ?? [];
    for (const file of foreign.files) {
      if (!file.startsWith("~/") || foreignHooksIn(dialect, foreign.agent, file, compat) === undefined) {
        continue;
      }
      const path = `${context.home}/${file.slice(2)}`;
      const source = known.find((candidate) => candidate.path === path) ?? known[0];
      if (source === undefined) {
        continue;
      }
      files.push({ owner: foreign.agent, path, source, rename: foreign.events });
    }
  }
  return files;
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
  const command = spec.command.replaceAll("{agent}", dialect.agent);
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
      for (const foreign of foreignHooksOf(runner)) {
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
    registrations.push(timeout === undefined ? { event, command } : { event, command, timeout });
  }
  return ok(registrations);
}
