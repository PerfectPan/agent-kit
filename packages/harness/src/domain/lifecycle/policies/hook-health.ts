import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import { hasLegacyMarker } from "../../bundle/policies/legacy-markers.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { HookDialect } from "../value-objects/hook-dialect.js";

/** Why `doctor` flags a command hook: it never runs, its timeout unit looks wrong, its program is gone, or it fires twice. */
export type HookProblem = "unknown-event" | "timeout-unit" | "stale-path" | "duplicate-hook";

/** One finding about a command hook, as `doctor` reports it. */
export interface HookFinding {
  readonly name: HookProblem;
  readonly status: "warn";
  readonly message: string;
  readonly locator: ArtifactLocator;
}

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

/** The event a locator addresses, as the file names it: the pointer's last segment, unescaped. */
const eventOf = (locator: ArtifactLocator): string =>
  (locator.pointer ?? "").split("/").at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~") ?? "";

/**
 * Findings about one hook registration: an event its dialect does not know, under none of its alias spellings either,
 * means the hook never runs; a timeout below one second where the dialect reads milliseconds looks like seconds
 * written in the wrong unit; a program given by absolute path that `exists` says is missing is a stale path.
 */
export function hookHealth(
  dialect: HookDialect | undefined,
  locator: ArtifactLocator,
  hook: unknown,
  exists: (path: string) => boolean
): readonly HookFinding[] {
  const findings: HookFinding[] = [];
  const event = eventOf(locator);
  const known =
    dialect === undefined ||
    Object.hasOwn(dialect.events, event) ||
    Object.values(dialect.events).some((spec) => spec.aliases?.includes(event) === true);
  if (!known) {
    findings.push({
      name: "unknown-event",
      status: "warn",
      message: `${dialect?.agent} has no hook event "${event}"; this hook never runs`,
      locator
    });
  }
  const timeout = typeof hook === "object" && hook !== null ? (hook as { timeout?: unknown }).timeout : undefined;
  if (dialect?.timeout?.unit === "milliseconds" && typeof timeout === "number" && timeout < 1000) {
    findings.push({
      name: "timeout-unit",
      status: "warn",
      message: `timeout ${timeout} is in milliseconds for ${dialect.agent}; it looks like seconds`,
      locator
    });
  }
  const program = hookProgram(locator.member ?? "");
  if (program.startsWith("/") && !exists(program)) {
    findings.push({ name: "stale-path", status: "warn", message: `${program} does not exist`, locator });
  }
  return findings;
}

/**
 * Findings about hooks that fire twice for one event in one agent: the same command twice, or, given an application's
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
        findings.push({
          name: "duplicate-hook",
          status: "warn",
          message: `${agent} runs this hook twice for ${event}`,
          locator: hook.locator
        });
      }
      seen.add(hook.command);
    }
    const marked = here.filter((hook) => hasLegacyMarker(markers, hook.command));
    const last = marked.at(-1);
    if (last !== undefined && new Set(marked.map((hook) => hook.command)).size > 1) {
      findings.push({
        name: "duplicate-hook",
        status: "warn",
        message: `${agent} runs ${marked.length} hooks of one application for ${event}`,
        locator: last.locator
      });
    }
  }
  return findings;
}
