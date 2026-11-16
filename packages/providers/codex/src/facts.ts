import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const CODEX_ID = "codex";
/** @public */
export const CODEX_DISPLAY_NAME = "Codex";
/** @public */
export const CODEX_HOME_DIR = ".codex";
/** @public */
export const HOME_ENV = "CODEX_HOME";
// The override names the Codex home itself.
/** @public */
export const CODEX_HOME: HomeRule = {
  envVar: HOME_ENV,
  defaultPath: [CODEX_HOME_DIR]
};
/** @public */
export const CODEX_SESSIONS_DIR = "sessions";
/** @public */
export const CODEX_ARCHIVED_SESSIONS_DIR = "archived_sessions";
/** @public */
export const CODEX_AUTH_FILE = "auth.json";
/** @public */
export const CODEX_AUTH_ARGS: readonly string[] = ["login", "status"];
/** @public */
export const CODEX_CONFIG_FILE = "config.toml";
/** @public */
export const CODEX_CONFIG_PATTERN: RegExp = /[\\/]config\.toml$/;
/** @public */
export const CODEX_HOOKS_FILE = "hooks.json";
/** @public */
export const CODEX_PLUGINS_DIR = "plugins";
/** @public */
export const CODEX_PLUGINS_POINTER = "/plugins";
/** @public */
export const CODEX_PLUGIN_CACHE_DIR: string = `${CODEX_PLUGINS_DIR}/cache`;
/** @public */
export const CODEX_PLUGIN_MANIFEST = ".codex-plugin/plugin.json";
/** @public */
export const CODEX_PLUGIN_HOOKS: string = `hooks/${CODEX_HOOKS_FILE}`;
/** @public */
export const CODEX_MARKETPLACE_MANIFEST = ".agents/plugins/marketplace.json";
/** @public */
export const CODEX_HOOKS_POINTER = "/hooks";
/** @public */
export const CODEX_HOOK_LAYOUT = "grouped";
/** @public */
export const CODEX_CONFIG_FORMAT = "toml";
/** @public */
export const CODEX_HOOK_FORMAT = "json";
/** @public */
export const CODEX_ROLLOUT_PREFIX = "rollout-";
/** @public */
export const CODEX_SESSION_SUFFIX = ".jsonl";
/** @public */
export const CODEX_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;
/** @public */
export const CODEX_ACP_COMMAND = "codex-acp";
/** @public */
export const CODEX_ACP_ENV: readonly string[] = ["OPENAI_*", "CODEX_*", "AZURE_OPENAI_*"];

/** @public */
export const agentMarkers: readonly string[] = [CODEX_ID, CODEX_HOME_DIR, HOME_ENV];
