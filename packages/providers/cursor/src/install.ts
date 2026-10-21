import {
  type HookRegistration,
  type InstallAdapter,
  type InstallContext,
  type BundleRef,
  type JsonValue,
  ownerSlug,
  agentsOf,
  jsonText,
  sharedSkillsDir,
  sharedAgentsDir
} from "@rivus/agent-kit-harness/spi";
import {
  CURSOR_ID,
  CURSOR_PLUGIN_HOME,
  CURSOR_LOCAL_PLUGINS,
  CURSOR_PLUGIN_MANIFEST,
  CURSOR_PLUGIN_HOOKS,
  CURSOR_HOOKS_FILE
} from "./facts.js";

// https://cursor.com/docs/plugins and https://cursor.com/docs/reference/plugins: a plugin under
// `~/.cursor/plugins/local/<name>/` with `.cursor-plugin/plugin.json` (only `name` is required) is discovered after a
// reload, and its `hooks/hooks.json` lists `{ "command" }` objects per event, with timeouts in seconds.
// Cursor has no verified identity home rule; plugins live under `~/.cursor` as documented.
function cursorHome(context: InstallContext): string {
  return `${context.home}/${CURSOR_PLUGIN_HOME}`;
}

function cursorPluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${cursorHome(context)}/${CURSOR_LOCAL_PLUGINS}/${ownerSlug(bundle.owner)}`;
}

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
  agent: CURSOR_ID,
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [cursorHome(context), sharedAgentsDir(context)],
  hookFile: (_strategy, bundle) => `${cursorPluginDir({ home: "~", env: {} }, bundle)}/${CURSOR_PLUGIN_HOOKS}`,
  renderHooks: (strategy, registrations, bundle, context) =>
    registrations.length === 0
      ? []
      : [
          {
            locator: { kind: "dir", path: cursorPluginDir(context, bundle) },
            content: {
              [CURSOR_PLUGIN_MANIFEST]: jsonText({ name: ownerSlug(bundle.owner) }),
              [CURSOR_PLUGIN_HOOKS]: jsonText(cursorHooksFile(registrations))
            },
            strategy,
            agents: agentsOf(registrations)
          }
        ],
  hookSources: (context) => [
    { path: `${cursorHome(context)}/${CURSOR_HOOKS_FILE}`, format: "json", layout: "flat" },
    { path: `${cursorHome(context)}/${CURSOR_LOCAL_PLUGINS}/*/${CURSOR_PLUGIN_HOOKS}`, format: "json", layout: "flat" }
  ],
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ]
};
