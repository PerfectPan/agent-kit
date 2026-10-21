import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const PI_ID = "pi";
export const PI_DISPLAY_NAME = "Pi";
// The override names the agent directory itself, rather than its parent.
export const PI_HOME: HomeRule = { envVar: "PI_CODING_AGENT_DIR", expandsTilde: true, defaultPath: [".pi", "agent"] };
export const PI_SESSIONS_DIR = "sessions";
export const PI_EXTENSIONS_DIR = "extensions";
export const PI_SETTINGS_FILE = "settings.json";
export const PI_EXTENSIONS_POINTER = "/extensions";
export const PI_EXTENSION_SUFFIX = ".ts";
export const PI_EXTENSION_SUFFIXES: readonly string[] = [".js", PI_EXTENSION_SUFFIX];
export const PI_SESSION_SUFFIX = ".jsonl";
export const PI_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;
