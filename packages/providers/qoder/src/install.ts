import type { InstallAdapter, InstallContext } from "@rivus/agent-kit-harness/spi";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { renderGroupedJsonHooks, renderSharedSkill, sharedAgentsDir } from "@rivus/agent-kit-harness/spi";
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
  renderHooks: (strategy, registrations, _bundle, context) =>
    renderGroupedJsonHooks(strategy, registrations, qoderSettingsFile(context), QODER_HOOKS_POINTER),
  renderSkill: renderSharedSkill,
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
