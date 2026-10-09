import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import { hasLegacyMarker } from "../../bundle/policies/legacy-markers.js";
import { type ArtifactLocator, pointerTail } from "../../install-plan/value-objects/artifact-locator.js";
import type { HookDialect } from "../value-objects/hook-dialect.js";

/** Why `doctor` flags a command hook: it never runs, its timeout unit looks wrong, its program is gone, or it fires twice. */
export type HookProblem = "unknown-event" | "timeout-unit" | "stale-path" | "duplicate-hook";

/**
 * One problem a command hook has, with the values that describe it; `doctor` renders the status and the message. A
 * `duplicate-hook` carries `markedCount` when more than one hook of one application fires for the event, and none
 * when the same command fires twice.
 */
export type HookFinding =
  | {
      readonly problem: "unknown-event";
      readonly locator: ArtifactLocator;
      readonly agent: CodingAgentId;
      readonly event: string;
    }
  | {
      readonly problem: "timeout-unit";
      readonly locator: ArtifactLocator;
      readonly agent: CodingAgentId;
      readonly timeout: number;
    }
  | { readonly problem: "stale-path"; readonly locator: ArtifactLocator; readonly program: string }
  | {
      readonly problem: "duplicate-hook";
      readonly locator: ArtifactLocator;
      readonly agent: CodingAgentId;
      readonly event: string;
      readonly markedCount?: number;
    };

/** One command hook an agent runs, by the event that fires it, as read from a hook configuration file. */
export interface CommandHook {
  readonly event: string;
  readonly command: string;
  readonly locator: ArtifactLocator;
}

const unquote = (token: string): string => token.replace(/^["']|["']$/g, "");

/** The program a command line runs: its first word, unquoted. */
export function hookProgram(command: string): string {
  return command.trim().split(/\s+/).map(unquote)[0] ?? "";
}

/** The event a locator addresses, as the file names it: the pointer's last segment, unescaped. No pointer names none. */
const eventOf = (locator: ArtifactLocator): string => pointerTail(locator.pointer) ?? "";

/**
 * Problems with one hook registration: an event its dialect does not know, under none of its alias spellings either,
 * means the hook never runs; a timeout below one second where the dialect reads milliseconds looks like seconds
 * written in the wrong unit; a program given by absolute path that `exists` says is missing is a stale path. The
 * registration arrives parsed, so no shape is checked here.
 */
export function hookHealth(
  dialect: HookDialect | undefined,
  locator: ArtifactLocator,
  hook: { readonly timeout?: number },
  exists: (path: string) => boolean
): readonly HookFinding[] {
  const findings: HookFinding[] = [];
  const event = eventOf(locator);
  const known =
    dialect === undefined ||
    Object.hasOwn(dialect.events, event) ||
    Object.values(dialect.events).some((spec) => spec.aliases?.includes(event) === true);
  if (dialect !== undefined && !known) {
    findings.push({ problem: "unknown-event", locator, agent: dialect.agent, event });
  }
  const { timeout } = hook;
  if (dialect?.timeout?.unit === "milliseconds" && timeout !== undefined && timeout < 1000) {
    findings.push({ problem: "timeout-unit", locator, agent: dialect.agent, timeout });
  }
  const program = hookProgram(locator.member ?? "");
  if (program.startsWith("/") && !exists(program)) {
    findings.push({ problem: "stale-path", locator, program });
  }
  return findings;
}

/**
 * Problems with hooks that fire twice for one event in one agent: the same command twice, or, given an application's
 * markers, more than one hook carrying one of them — an old hook left in a settings file next to the plugin that
 * replaced it. Markers match the way `isLegacyArtifact` matches: blank ones never match.
 */
export function duplicateHooks(
  agent: CodingAgentId,
  hooks: readonly CommandHook[],
  markers: readonly string[]
): readonly HookFinding[] {
  const findings: HookFinding[] = [];
  for (const event of new Set(hooks.map((hook) => hook.event))) {
    const here = hooks.filter((hook) => hook.event === event);
    const seen = new Set<string>();
    for (const hook of here) {
      if (seen.has(hook.command)) {
        findings.push({ problem: "duplicate-hook", locator: hook.locator, agent, event });
      }
      seen.add(hook.command);
    }
    const marked = here.filter((hook) => hasLegacyMarker(markers, hook.command));
    const last = marked.at(-1);
    if (last !== undefined && new Set(marked.map((hook) => hook.command)).size > 1) {
      findings.push({ problem: "duplicate-hook", locator: last.locator, agent, event, markedCount: marked.length });
    }
  }
  return findings;
}
