import {
  CLAUDE_CODE_ID,
  CLAUDE_CODE_HOME_DIR,
  CLAUDE_CODE_HOME,
  CLAUDE_CODE_SETTINGS_FILE,
  CLAUDE_CODE_SKILLS_DIR,
  CLAUDE_CODE_PLUGIN_MANIFEST,
  CLAUDE_CODE_PLUGIN_HOOKS,
  CLAUDE_CODE_HOOKS_POINTER,
  CLAUDE_CODE_HOOK_FORMAT,
  CLAUDE_CODE_HOOK_LAYOUT,
  CLAUDE_CODE_SETTINGS_PATH
} from "./facts.js";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import type { BundleRef, InstallContext } from "@rivus/agent-kit-harness/spi";
import { type InstallAdapter, ownerSlug } from "@rivus/agent-kit-harness/spi";
import { agentsOf, commandHook, groupedHooksFile, jsonText } from "@rivus/agent-kit-harness/spi";

// https://code.claude.com/docs/en/plugins (skills-dir plugins load in every session as `<name>@skills-dir`, enabled
// by default, hooks in `hooks/hooks.json` wrapped in `"hooks"`), https://code.claude.com/docs/en/settings and
// https://code.claude.com/docs/en/skills.

/** Claude Code's home: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
function claudeHome(context: InstallContext): string {
  return homeFromRule(CLAUDE_CODE_ID, CLAUDE_CODE_HOME, context).path;
}

function claudeSettingsFile(context: InstallContext): string {
  return `${claudeHome(context)}/${CLAUDE_CODE_SETTINGS_FILE}`;
}

/** Skills, and the skills-dir plugins that sit beside them. */
function claudeSkillsDir(context: InstallContext): string {
  return `${claudeHome(context)}/${CLAUDE_CODE_SKILLS_DIR}`;
}

/** The owner's skills-dir plugin: a directory with `.claude-plugin/plugin.json`, loaded without any install step. */
function claudePluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${claudeSkillsDir(context)}/${ownerSlug(bundle.owner)}`;
}

/**
 * Hooks go into a skills-dir plugin, which needs no settings change and which Grok never loads; Cursor and Grok
 * would run the same hooks from `~/.claude/settings.json` too, so that file is only the fallback. Skills go into
 * `~/.claude/skills`, the only skills directory Claude Code reads.
 */
export const claudeCodeInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: CLAUDE_CODE_ID,
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [claudeHome(context)],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `~/${CLAUDE_CODE_HOME_DIR}/${CLAUDE_CODE_SKILLS_DIR}/${ownerSlug(bundle.owner)}/${CLAUDE_CODE_PLUGIN_HOOKS}`
      : CLAUDE_CODE_SETTINGS_PATH,
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    if (strategy === "native-plugin") {
      const name = ownerSlug(bundle.owner);
      return [
        {
          locator: { kind: "dir", path: claudePluginDir(context, bundle) },
          content: {
            [CLAUDE_CODE_PLUGIN_MANIFEST]: jsonText({ name, description: `Hooks installed by ${bundle.owner}` }),
            [CLAUDE_CODE_PLUGIN_HOOKS]: jsonText(groupedHooksFile(registrations))
          },
          strategy,
          agents: agentsOf(registrations)
        }
      ];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "json-entry",
        path: claudeSettingsFile(context),
        pointer: `${CLAUDE_CODE_HOOKS_POINTER}/${registration.event}`,
        member: registration.command,
        memberIn: "hook-group"
      },
      content: commandHook(registration),
      strategy,
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${claudeSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: claudeSettingsFile(context), format: CLAUDE_CODE_HOOK_FORMAT, layout: CLAUDE_CODE_HOOK_LAYOUT },
    {
      path: `${claudeSkillsDir(context)}/*/${CLAUDE_CODE_PLUGIN_HOOKS}`,
      format: CLAUDE_CODE_HOOK_FORMAT,
      layout: CLAUDE_CODE_HOOK_LAYOUT
    }
  ],
  legacySources: (context) => [
    {
      kind: "entries",
      format: CLAUDE_CODE_HOOK_FORMAT,
      path: claudeSettingsFile(context),
      pointer: CLAUDE_CODE_HOOKS_POINTER,
      memberIn: "hook-group"
    }
  ]
};
