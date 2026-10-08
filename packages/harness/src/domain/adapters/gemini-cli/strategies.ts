import { type InstallAdapter, ownerSlug } from "../../bundle/index.js";
import { agentsOf, commandHook, groupedHooksFile, jsonText, sharedSkillsDir } from "../install-files.js";
import { geminiExtensionDir, geminiHome, geminiSettingsFile } from "./config-files.js";

/**
 * Hooks go into an extension, which is enabled once its directory exists and whose hooks still run in a folder the
 * user has not trusted; the settings file's hook groups are the fallback. Timeouts are in milliseconds, which
 * `hookRegistrations` already converted to.
 */
export const geminiCliInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "gemini-cli",
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [geminiHome(context), `${context.home}/.agents`],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `~/.gemini/extensions/${ownerSlug(bundle.owner)}/hooks/hooks.json`
      : "~/.gemini/settings.json",
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    if (strategy === "native-plugin") {
      return [
        {
          locator: { kind: "dir", path: geminiExtensionDir(context, bundle) },
          content: {
            "gemini-extension.json": jsonText({ name: ownerSlug(bundle.owner), version: bundle.version }),
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
        path: geminiSettingsFile(context),
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
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: geminiSettingsFile(context), format: "json", layout: "grouped" },
    { path: `${geminiHome(context)}/extensions/*/hooks/hooks.json`, format: "json", layout: "grouped" }
  ],
  legacySources: (context) => [
    { kind: "entries", format: "json", path: geminiSettingsFile(context), pointer: "/hooks", memberIn: "hook-group" }
  ]
};
