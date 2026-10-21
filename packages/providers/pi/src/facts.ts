export const PI_ID = "pi";
export const PI_DISPLAY_NAME = "Pi";
export const HOME_DIR = ".pi";
export const HOME_ENV = "PI_CODING_AGENT_DIR";
// The override names the agent directory itself, rather than its parent.
export const PI_HOME: {
  readonly envVar: string;
  readonly defaultPath: readonly string[];
  readonly expandsTilde: true;
} = { envVar: HOME_ENV, expandsTilde: true, defaultPath: [HOME_DIR, "agent"] };
export const PI_SESSIONS_DIR = "sessions";
export const PI_EXTENSIONS_DIR = "extensions";
export const PI_SETTINGS_FILE = "settings.json";
export const PI_EXTENSIONS_POINTER = "/extensions";
export const PI_EXTENSION_SUFFIX = ".ts";
export const PI_EXTENSION_SUFFIXES: readonly string[] = [".js", PI_EXTENSION_SUFFIX];
export const PI_SESSION_SUFFIX = ".jsonl";
export const PI_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;

/** Agent-specific values forbidden in context source; generic path segments are deliberately excluded. */
export const agentMarkers: readonly string[] = [PI_ID, HOME_DIR, HOME_ENV];
