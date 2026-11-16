import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const OPENCODE_ID = "opencode";
const HOME_ENV = "XDG_DATA_HOME";
// OpenCode keeps data in the XDG data directory and plugins in the XDG configuration directory.
/** @public */
export const OPENCODE_HOME: HomeRule = {
  envVar: HOME_ENV,
  envSubpath: [OPENCODE_ID],
  defaultPath: [".local", "share", OPENCODE_ID]
};
/** @public */
export const OPENCODE_DATABASE = "opencode.db";
/** @public */
export const OPENCODE_MESSAGE_DIR = "storage/message";
/** @public */
export const OPENCODE_AUTH_FILE = "auth.json";
/** @public */
export const OPENCODE_AUTH_ENV = "OPENCODE_AUTH_CONTENT";
/** @public */
export const OPENCODE_PLUGINS_DIR = "plugins";
/** @public */
export const OPENCODE_CONFIG_FILE = "opencode.json";
/** @public */
export const OPENCODE_PLUGINS_POINTER = "/plugin";
/** @public */
export const OPENCODE_PLUGIN_SUFFIX = ".js";
/** @public */
export const OPENCODE_PLUGIN_SUFFIXES: readonly string[] = [OPENCODE_PLUGIN_SUFFIX, ".ts"];
/** @public */
export const OPENCODE_MESSAGE_SUFFIX = ".json";
/** @public */
export const OPENCODE_DATABASE_SUFFIX = ".db";
/** @public */
export const OPENCODE_WAL_SUFFIX = "-wal";
/** @public */
export const OPENCODE_ACP_ARGS: readonly string[] = ["acp"];
/** @public */
export const OPENCODE_ACP_ENV: readonly string[] = [
  "OPENCODE_*",
  "*_API_KEY",
  "ANTHROPIC_*",
  "OPENAI_*",
  "AWS_*",
  "AZURE_*",
  "GOOGLE_*",
  "VERTEX_*"
];

/** The bridge remembers the session under a key absent from native payloads. */
/** @public */
export const OPENCODE_CURRENT_SESSION_FIELD = "currentSessionId";

/** @public */
export const agentMarkers: readonly string[] = [OPENCODE_ID];
