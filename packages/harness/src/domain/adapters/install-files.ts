import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookRegistration, InstallContext, PlacedRegistration } from "../bundle/index.js";
import type { JsonValue } from "../ledger/index.js";

/** JSON as the kit writes whole files: two-space indentation and a final newline. */
export function jsonText(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** One hook as Claude Code's settings files and the agents that copy their format (Codex, Gemini CLI, Grok) list it. */
export function commandHook(registration: HookRegistration): JsonValue {
  return registration.timeout === undefined
    ? { type: "command", command: registration.command }
    : { type: "command", command: registration.command, timeout: registration.timeout };
}

/**
 * A hooks file in Claude Code's format, `{ "hooks": { "<Event>": [{ "hooks": [...] }] } }`, with one group per event
 * and no matcher, so every hook observes every occurrence of its event.
 */
export function groupedHooksFile(registrations: readonly HookRegistration[]): JsonValue {
  const hooks: Record<string, JsonValue[]> = {};
  for (const registration of registrations) {
    hooks[registration.event] = [...(hooks[registration.event] ?? []), { hooks: [commandHook(registration)] }];
  }
  return { hooks };
}

/** The `~/.agents/skills` directory that every agent but Claude Code reads. */
export function sharedSkillsDir(context: InstallContext): string {
  return `${context.home}/.agents/skills`;
}

/** `$XDG_CONFIG_HOME`, or `~/.config` when it is unset or not absolute. */
export function configHome(context: InstallContext): string {
  const xdg = context.env.XDG_CONFIG_HOME;
  return xdg !== undefined && xdg.startsWith("/") ? xdg.replace(/\/+$/, "") : `${context.home}/.config`;
}

/** Every agent that relies on one of the registrations, for an Artifact that holds them all. */
export function agentsOf(registrations: readonly PlacedRegistration[]): readonly CodingAgentId[] {
  return [...new Set(registrations.flatMap((registration) => registration.agents))].toSorted();
}
