import type { InstallAdapter, InstallContext, JsonValue } from "@rivus/agent-kit-harness/spi";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { elementMember, sharedAgentsDir, sharedSkillsDir } from "@rivus/agent-kit-harness/spi";
import type { HookRegistration } from "@rivus/agent-kit-harness/spi";
import {
  KIMI_CONFIG_FILE,
  KIMI_CONFIG_PATH,
  KIMI_HOOK_FORMAT,
  KIMI_HOOK_MEMBER_KEYS,
  KIMI_HOOKS_POINTER,
  KIMI_HOME,
  KIMI_ID
} from "./facts.js";

// https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html (hook rules are `[[hooks]]` entries of the
// user config.toml, fields event, matcher, command, timeout) and /customization/skills.html plus
// /configuration/data-locations.html (generic user skills stay at ~/.agents/skills, shared across tools).

/** Kimi's data root: `KIMI_CODE_HOME`, or `~/.kimi-code`. */
function kimiHome(context: InstallContext): string {
  return homeFromRule(KIMI_ID, KIMI_HOME, context).path;
}

function kimiConfigFile(context: InstallContext): string {
  return `${kimiHome(context)}/${KIMI_CONFIG_FILE}`;
}

/** One `[[hooks]]` entry: the element carries its own event, and the command identifies it. */
function kimiHookEntry(registration: HookRegistration): JsonValue {
  const { event, command, timeout } = registration;
  return timeout === undefined ? { event, command } : { event, command, timeout };
}

/**
 * Hooks become `[[hooks]]` entries of `config.toml`, which only Kimi reads; skills go into `~/.agents/skills`, the
 * generic directory Kimi reads beside its own.
 */
export const kimiInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: KIMI_ID,
  hookStrategies: ["shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [kimiHome(context), sharedAgentsDir(context)],
  hookFile: () => KIMI_CONFIG_PATH,
  renderHooks(strategy, registrations, _bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "toml-entry",
        path: kimiConfigFile(context),
        pointer: KIMI_HOOKS_POINTER,
        member: elementMember([registration.event, registration.command]),
        memberIn: "element",
        memberKeys: KIMI_HOOK_MEMBER_KEYS
      },
      content: kimiHookEntry(registration),
      strategy,
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: kimiConfigFile(context), format: KIMI_HOOK_FORMAT, layout: "event-list", pointer: KIMI_HOOKS_POINTER }
  ],
  legacySources: (context) => [
    {
      kind: "entries",
      format: KIMI_HOOK_FORMAT,
      path: kimiConfigFile(context),
      pointer: KIMI_HOOKS_POINTER,
      memberIn: "element"
    }
  ]
};
