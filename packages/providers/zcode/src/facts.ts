import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const ZCODE_ID = "zcode";
export const ZCODE_DISPLAY_NAME = "ZCode";
export const HOME_DIR = ".zcode";
export const HOME_ENV = "ZCODE_STORAGE_DIR";
export const ZCODE_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
export const ZCODE_DB_DIR = "cli/db";
export const ZCODE_DATABASE = "db.sqlite";
export const ZCODE_WAL_SUFFIX = "-wal";
export const ZCODE_CONFIG_FILE = "cli/config.json";
export const ZCODE_KIT_PLUGINS = "agent-kit/zcode";
export const ZCODE_PLUGIN_MANIFEST = ".zcode-plugin/plugin.json";
export const ZCODE_PLUGIN_HOOKS = "hooks/hooks.json";
export const ZCODE_PLUGIN_DIRS_POINTER = "/plugins/dirs";
// The login the CLI shares with the app sits under ZCODE_DATA_BASE_DIR (default the home directory), not under
// ZCODE_STORAGE_DIR; the variable-named base is what a probe path cannot express.
export const ZCODE_CREDENTIAL_FILE = "~/.zcode/v2/credentials.json";
/** Keys whose non-empty string value means a login is stored; checked by name only, never read out. */
export const ZCODE_CREDENTIAL_KEYS: readonly string[] = [
  "oauth:bigmodel:access_token",
  "oauth:zai:access_token",
  "zcodejwttoken"
];

/** The session id ZCode exports to every hook process, beside Claude Code's `CLAUDE_CODE_SESSION_ID`. */
export const ZCODE_SESSION_ENV = "ZCODE_SESSION_ID";
/** A payload field only ZCode's hook input carries; see the hook dialect. */
export const ZCODE_HOST_FIELD = "traceId";

export const agentMarkers: readonly string[] = [ZCODE_ID, HOME_DIR, HOME_ENV];
