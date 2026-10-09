import { type HookRegistration, type InstallAdapter, ownerSlug } from "../../index.js";
import type { JsonValue } from "../../../ledger/index.js";
import { agentsOf, jsonText, sharedSkillsDir } from "../install-files.js";
import { cursorHome, cursorPluginDir } from "./config-files.js";

/** Cursor's hook lists hold `{ command, timeout? }` objects directly, without Claude Code's groups. */
function cursorHooksFile(registrations: readonly HookRegistration[]): JsonValue {
  const hooks: Record<string, JsonValue[]> = {};
  for (const { event, command, timeout } of registrations) {
    hooks[event] = [...(hooks[event] ?? []), timeout === undefined ? { command } : { command, timeout }];
  }
  return { hooks };
}

/**
 * Hooks go into a local plugin. Cursor's permission hooks are gates (see its HookDialect), so `hookRegistrations`
 * refuses an observer there; Cursor also runs `~/.claude/settings.json`, which `placeHooks` accounts for when Claude
 * Code falls back to that file.
 */
export const cursorInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "cursor",
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [cursorHome(context), `${context.home}/.agents`],
  hookFile: (_strategy, bundle) => `~/.cursor/plugins/local/${ownerSlug(bundle.owner)}/hooks/hooks.json`,
  renderHooks: (strategy, registrations, bundle, context) =>
    registrations.length === 0
      ? []
      : [
          {
            locator: { kind: "dir", path: cursorPluginDir(context, bundle) },
            content: {
              ".cursor-plugin/plugin.json": jsonText({ name: ownerSlug(bundle.owner) }),
              "hooks/hooks.json": jsonText(cursorHooksFile(registrations))
            },
            strategy,
            agents: agentsOf(registrations)
          }
        ],
  hookSources: (context) => [
    { path: `${cursorHome(context)}/hooks.json`, format: "json", layout: "flat" },
    { path: `${cursorHome(context)}/plugins/local/*/hooks/hooks.json`, format: "json", layout: "flat" }
  ],
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ]
};
