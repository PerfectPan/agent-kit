export const CODEX_ID = "codex";
export const CODEX_DISPLAY_NAME = "Codex";
export const CODEX_COMMAND: string = CODEX_ID;
export const CODEX_HOME_DIR = ".codex";
export const HOME_ENV = "CODEX_HOME";
// The override names the Codex home itself.
export const CODEX_HOME: { readonly envVar: string; readonly defaultPath: readonly string[] } = {
  envVar: HOME_ENV,
  defaultPath: [CODEX_HOME_DIR]
};
export const CODEX_SESSIONS_DIR = "sessions";
export const CODEX_ARCHIVED_SESSIONS_DIR = "archived_sessions";
export const CODEX_AUTH_FILE = "auth.json";
export const CODEX_AUTH_ARGS: readonly string[] = ["login", "status"];
export const CODEX_CONFIG_FILE = "config.toml";
export const CODEX_CONFIG_PATTERN: RegExp = /[\\/]config\.toml$/;
export const CODEX_HOOKS_FILE = "hooks.json";
export const CODEX_PLUGINS_DIR = "plugins";
export const CODEX_PLUGINS_POINTER = "/plugins";
export const CODEX_PLUGIN_CACHE_DIR: string = `${CODEX_PLUGINS_DIR}/cache`;
export const CODEX_PLUGIN_MANIFEST = ".codex-plugin/plugin.json";
export const CODEX_PLUGIN_HOOKS: string = `hooks/${CODEX_HOOKS_FILE}`;
export const CODEX_MARKETPLACE_MANIFEST = ".agents/plugins/marketplace.json";
export const CODEX_HOOKS_POINTER = "/hooks";
export const CODEX_HOOK_LAYOUT = "grouped";
export const CODEX_CONFIG_FORMAT = "toml";
export const CODEX_HOOK_FORMAT = "json";
export const CODEX_ROLLOUT_PREFIX = "rollout-";
export const CODEX_SESSION_SUFFIX = ".jsonl";
export const CODEX_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;
export const CODEX_ACP_COMMAND = "codex-acp";
export const CODEX_ACP_ENV: readonly string[] = ["OPENAI_*", "CODEX_*", "AZURE_OPENAI_*"];

/** Agent-specific values forbidden in context source; generic path segments are deliberately excluded. */
export const agentMarkers: readonly string[] = [CODEX_ID, CODEX_HOME_DIR, HOME_ENV];
