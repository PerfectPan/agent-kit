import type { InstallAdapter, InstallContext } from "@rivus/agent-kit-harness/spi";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { commandHook, sharedAgentsDir, sharedSkillsDir } from "@rivus/agent-kit-harness/spi";
import {
  QODER_HOME,
  QODER_HOOK_FORMAT,
  QODER_HOOK_LAYOUT,
  QODER_HOOKS_POINTER,
  QODER_ID,
  QODER_SETTINGS_FILE,
  QODER_SETTINGS_PATH
} from "./facts.js";

// Hooks live in the user `~/.qoder/settings.json` under the Claude Code `hooks` shape (the CLI ships
// `qodercli hooks migrate` from Claude Code, and the agent SDK's settings type carries the same `permissions` and
// hook fields). Skills go into the shared `~/.agents/skills` directory the CLI manages with `qodercli skills`.

/** Qoder's user config root: `QODER_CONFIG_DIR`, or `~/.qoder`. */
function qoderHome(context: InstallContext): string {
  return homeFromRule(QODER_ID, QODER_HOME, context).path;
}

function qoderSettingsFile(context: InstallContext): string {
  return `${qoderHome(context)}/${QODER_SETTINGS_FILE}`;
}

/**
 * Hooks become grouped entries of `settings.json`, the same shape Claude Code writes; skills go into
 * `~/.agents/skills`, the shared directory.
 */
export const qoderInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: QODER_ID,
  hookStrategies: ["shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [qoderHome(context), sharedAgentsDir(context)],
  hookFile: () => QODER_SETTINGS_PATH,
  renderHooks(strategy, registrations, _bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "json-entry",
        path: qoderSettingsFile(context),
        pointer: `${QODER_HOOKS_POINTER}/${registration.event}`,
        member: registration.command,
        memberIn: "hook-group"
      },
      content: commandHook(registration),
      strategy,
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: qoderSettingsFile(context), format: QODER_HOOK_FORMAT, layout: QODER_HOOK_LAYOUT }
  ],
  legacySources: (context) => [
    {
      kind: "entries",
      format: QODER_HOOK_FORMAT,
      path: qoderSettingsFile(context),
      pointer: QODER_HOOKS_POINTER,
      memberIn: "hook-group"
    }
  ]
};
