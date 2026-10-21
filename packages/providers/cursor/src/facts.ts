export const CURSOR_ID = "cursor";
export const CURSOR_DISPLAY_NAME = "Cursor";
export const CURSOR_AGENT_COMMAND = "cursor-agent";
export const CURSOR_APP_PATH = "/Applications/Cursor.app";
export const CURSOR_CREDENTIAL_PATHS: readonly string[] = [
  "~/.config/cursor/auth.json",
  "~/AppData/Roaming/Cursor/auth.json"
];
export const CURSOR_CONFIG_PATHS: readonly string[] = [
  "~/Library/Application Support/Cursor/User/globalStorage",
  "~/.config/Cursor/User/globalStorage",
  "~/AppData/Roaming/Cursor/User/globalStorage",
  ...CURSOR_CREDENTIAL_PATHS
];
export const CURSOR_PLUGIN_HOME = ".cursor";
export const CURSOR_LOCAL_PLUGINS = "plugins/local";
export const CURSOR_PLUGIN_MANIFEST = ".cursor-plugin/plugin.json";
export const CURSOR_PLUGIN_HOOKS = "hooks/hooks.json";
export const CURSOR_HOOKS_FILE = "hooks.json";
export const CURSOR_VERSION_FIELD = "cursor_version";
export const CURSOR_VERSION_ENV = "CURSOR_VERSION";
export const CURSOR_TRANSCRIPT_ENV = "CURSOR_TRANSCRIPT_PATH";
export const CURSOR_FOREIGN_AGENT = "claude-code";
export const CURSOR_FOREIGN_HOOK_FILES: readonly string[] = [
  "~/.claude/settings.json",
  ".claude/settings.json",
  ".claude/settings.local.json"
];
