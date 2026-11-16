import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const GEMINI_CLI_ID = "gemini-cli";
/** @public */
export const GEMINI_CLI_DISPLAY_NAME = "Gemini CLI";
/** @public */
export const GEMINI_CLI_COMMAND = "gemini";
/** @public */
export const HOME_DIR = ".gemini";
/** @public */
export const HOME_ENV = "GEMINI_CLI_HOME";
// The override names the user's home directory; the CLI appends its own directory.
/** @public */
export const GEMINI_CLI_HOME: HomeRule = { envVar: HOME_ENV, envSubpath: [HOME_DIR], defaultPath: [HOME_DIR] };
/** @public */
export const GEMINI_CLI_SETTINGS_FILE = "settings.json";
/** @public */
export const GEMINI_CLI_CREDENTIAL_FILE = "oauth_creds.json";
/** @public */
export const GEMINI_CLI_API_KEY_ENV = "GEMINI_API_KEY";
/** @public */
export const GEMINI_CLI_SESSION_ENV = "GEMINI_SESSION_ID";
/** @public */
export const GEMINI_CLI_CWD_ENV = "GEMINI_CWD";
/** @public */
export const GEMINI_CLI_TMP_DIR = "tmp";
/** @public */
export const GEMINI_CLI_CHATS_DIR = "chats";
/** @public */
export const GEMINI_CLI_EXTENSIONS_DIR = "extensions";
/** @public */
export const GEMINI_CLI_EXTENSION_FILE = "gemini-extension.json";
/** @public */
export const GEMINI_CLI_HOOKS_FILE = "hooks/hooks.json";
/** @public */
export const GEMINI_CLI_HOOKS_POINTER = "/hooks";
/** @public */
export const GEMINI_CLI_JSONL_SUFFIX = ".jsonl";
/** @public */
export const GEMINI_CLI_JSON_SUFFIX = ".json";
/** @public */
export const GEMINI_CLI_CHAT_SUFFIX_PATTERN: RegExp = /\.jsonl?$/;
/** @public */
export const GEMINI_CLI_MESSAGE_TYPE = "gemini";
/** @public */
export const GEMINI_CLI_ACP_ARGS: readonly string[] = ["--experimental-acp"];
/** @public */
export const GEMINI_CLI_ACP_ENV: readonly string[] = ["GEMINI_*", "GOOGLE_*"];

/** @public */
export const agentMarkers: readonly string[] = [GEMINI_CLI_ID, GEMINI_CLI_COMMAND, HOME_DIR, HOME_ENV];
