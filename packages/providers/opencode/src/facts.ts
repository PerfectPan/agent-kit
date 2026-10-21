import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const OPENCODE_ID = "opencode";
// OpenCode keeps data in the XDG data directory and plugins in the XDG configuration directory.
export const OPENCODE_HOME: HomeRule = {
  envVar: "XDG_DATA_HOME",
  envSubpath: [OPENCODE_ID],
  defaultPath: [".local", "share", OPENCODE_ID]
};
export const OPENCODE_DATABASE = "opencode.db";
export const OPENCODE_MESSAGE_DIR = "storage/message";
export const OPENCODE_AUTH_FILE = "auth.json";
export const OPENCODE_AUTH_ENV = "OPENCODE_AUTH_CONTENT";
export const OPENCODE_PLUGINS_DIR = "plugins";
export const OPENCODE_CONFIG_FILE = "opencode.json";
export const OPENCODE_PLUGINS_POINTER = "/plugin";
export const OPENCODE_PLUGIN_SUFFIX = ".js";
export const OPENCODE_PLUGIN_SUFFIXES: readonly string[] = [OPENCODE_PLUGIN_SUFFIX, ".ts"];
export const OPENCODE_MESSAGE_SUFFIX = ".json";
export const OPENCODE_DATABASE_SUFFIX = ".db";
export const OPENCODE_WAL_SUFFIX = "-wal";
export const OPENCODE_ACP_ARGS: readonly string[] = ["acp"];
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
export const OPENCODE_CURRENT_SESSION_FIELD = "currentSessionId";
