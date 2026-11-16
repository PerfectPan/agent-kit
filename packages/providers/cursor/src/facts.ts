/** @public */
export const CURSOR_ID = "cursor";
/** @public */
export const CURSOR_DISPLAY_NAME = "Cursor";
/** @public */
export const CURSOR_AGENT_COMMAND = "cursor-agent";
/** @public */
export const CURSOR_APP_PATH = "/Applications/Cursor.app";
/** @public */
export const CURSOR_CREDENTIAL_PATHS: readonly string[] = [
  "~/.config/cursor/auth.json",
  "~/AppData/Roaming/Cursor/auth.json"
];
/** @public */
export const CURSOR_CONFIG_PATHS: readonly string[] = [
  "~/Library/Application Support/Cursor/User/globalStorage",
  "~/.config/Cursor/User/globalStorage",
  "~/AppData/Roaming/Cursor/User/globalStorage",
  ...CURSOR_CREDENTIAL_PATHS
];
/** @public */
export const CURSOR_PLUGIN_HOME = ".cursor";
/** @public */
export const CURSOR_LOCAL_PLUGINS = "plugins/local";
/** @public */
export const CURSOR_PLUGIN_MANIFEST = ".cursor-plugin/plugin.json";
/** @public */
export const CURSOR_PLUGIN_HOOKS = "hooks/hooks.json";
/** @public */
export const CURSOR_HOOKS_FILE = "hooks.json";
/** @public */
export const CURSOR_VERSION_ENV = "CURSOR_VERSION";
/** @public */
export const CURSOR_VERSION_FIELD = "cursor_version";
/** @public */
export const CURSOR_TRANSCRIPT_ENV = "CURSOR_TRANSCRIPT_PATH";
/** @public */
export const CURSOR_FOREIGN_AGENT = "claude-code";
/** @public */
export const CURSOR_FOREIGN_HOOK_FILES: readonly string[] = [
  "~/.claude/settings.json",
  ".claude/settings.json",
  ".claude/settings.local.json"
];

/** @public */
export const agentMarkers: readonly string[] = [
  CURSOR_ID,
  CURSOR_AGENT_COMMAND,
  CURSOR_PLUGIN_HOME,
  CURSOR_VERSION_ENV
];
