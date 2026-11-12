import type { InstallAdapter, InstallContext } from "@rivus/agent-kit-harness/spi";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { commandHook, sharedAgentsDir } from "@rivus/agent-kit-harness/spi";
import {
  DIM_HOME,
  DIM_HOOK_FORMAT,
  DIM_HOOK_LAYOUT,
  DIM_HOOKS_FILE,
  DIM_HOOKS_POINTER,
  DIM_ID,
  DIM_SKILLS_DIR
} from "./facts.js";

// Hook facts from the CLI (0.5.27): `<home>/hooks.json` holds the Claude Code grouped shape under a `hooks` key, and
// a project `.dimcode/hooks.json` beside it; hooks must be trusted through `dim hooks`. Skills live in
// `<home>/skills` as SKILL.md directories.

/** DimCode's data root: `DIMCODE_HOME`, or `~/.dimcode/v2`. */
function dimHome(context: InstallContext): string {
  return homeFromRule(DIM_ID, DIM_HOME, context).path;
}

function dimHooksFile(context: InstallContext): string {
  return `${dimHome(context)}/${DIM_HOOKS_FILE}`;
}

/**
 * Hooks become grouped entries of `hooks.json`, the shape Claude Code writes; skills go into the data root's
 * `skills` directory.
 */
export const dimInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: DIM_ID,
  hookStrategies: ["shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [dimHome(context), sharedAgentsDir(context)],
  hookFile: () => `~/.dimcode/v2/${DIM_HOOKS_FILE}`,
  renderHooks(strategy, registrations, _bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "json-entry",
        path: dimHooksFile(context),
        pointer: `${DIM_HOOKS_POINTER}/${registration.event}`,
        member: registration.command,
        memberIn: "hook-group"
      },
      content: commandHook(registration),
      strategy,
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    {
      locator: { kind: "dir", path: `${dimHome(context)}/${DIM_SKILLS_DIR}/${skill.name}` },
      content: skill.files,
      strategy
    }
  ],
  hookSources: (context) => [{ path: dimHooksFile(context), format: DIM_HOOK_FORMAT, layout: DIM_HOOK_LAYOUT }],
  legacySources: (context) => [
    {
      kind: "entries",
      format: DIM_HOOK_FORMAT,
      path: dimHooksFile(context),
      pointer: DIM_HOOKS_POINTER,
      memberIn: "hook-group"
    }
  ]
};
