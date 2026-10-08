import { resolveHome } from "@rivus/agent-kit-catalog";

import { type BundleRef, type InstallContext, ownerSlug } from "../../bundle/index.js";

// https://code.claude.com/docs/en/plugins (skills-dir plugins load in every session as `<name>@skills-dir`, enabled
// by default, hooks in `hooks/hooks.json` wrapped in `"hooks"`), https://code.claude.com/docs/en/settings and
// https://code.claude.com/docs/en/skills.

/** Claude Code's home: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function claudeHome(context: InstallContext): string {
  return resolveHome("claude-code", context).path;
}

export function claudeSettingsFile(context: InstallContext): string {
  return `${claudeHome(context)}/settings.json`;
}

/** Skills, and the skills-dir plugins that sit beside them. */
export function claudeSkillsDir(context: InstallContext): string {
  return `${claudeHome(context)}/skills`;
}

/** The owner's skills-dir plugin: a directory with `.claude-plugin/plugin.json`, loaded without any install step. */
export function claudePluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${claudeSkillsDir(context)}/${ownerSlug(bundle.owner)}`;
}
