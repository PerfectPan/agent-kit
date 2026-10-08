import { type InstallAdapter, ownerSlug } from "../../bundle/index.js";
import { agentsOf, commandHook, groupedHooksFile, jsonText } from "../install-files.js";
import { claudeHome, claudePluginDir, claudeSettingsFile, claudeSkillsDir } from "./config-files.js";

/**
 * Hooks go into a skills-dir plugin, which needs no settings change and which Grok never loads; Cursor and Grok
 * would run the same hooks from `~/.claude/settings.json` too, so that file is only the fallback. Skills go into
 * `~/.claude/skills`, the only skills directory Claude Code reads.
 */
export const claudeCodeInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "claude-code",
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [claudeHome(context)],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `~/.claude/skills/${ownerSlug(bundle.owner)}/hooks/hooks.json`
      : "~/.claude/settings.json",
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
            ".claude-plugin/plugin.json": jsonText({ name, description: `Hooks installed by ${bundle.owner}` }),
            "hooks/hooks.json": jsonText(groupedHooksFile(registrations))
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
        pointer: `/hooks/${registration.event}`,
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
    { path: claudeSettingsFile(context), format: "json", layout: "grouped" },
    { path: `${claudeSkillsDir(context)}/*/hooks/hooks.json`, format: "json", layout: "grouped" }
  ],
  legacySources: (context) => [
    { kind: "entries", format: "json", path: claudeSettingsFile(context), pointer: "/hooks", memberIn: "hook-group" }
  ]
};
