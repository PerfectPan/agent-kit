import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const GEMINI_CLI_ID = "gemini-cli";
export const GEMINI_CLI_DISPLAY_NAME = "Gemini CLI";
export const GEMINI_CLI_COMMAND = "gemini";
const HOME_DIR = ".gemini";
// The override names the user's home directory; the CLI appends its own directory.
export const GEMINI_CLI_HOME: HomeRule = { envVar: "GEMINI_CLI_HOME", envSubpath: [HOME_DIR], defaultPath: [HOME_DIR] };
export const GEMINI_CLI_SETTINGS_FILE = "settings.json";
export const GEMINI_CLI_CREDENTIAL_FILE = "oauth_creds.json";
export const GEMINI_CLI_API_KEY_ENV = "GEMINI_API_KEY";
export const GEMINI_CLI_SESSION_ENV = "GEMINI_SESSION_ID";
export const GEMINI_CLI_CWD_ENV = "GEMINI_CWD";
export const GEMINI_CLI_TMP_DIR = "tmp";
export const GEMINI_CLI_CHATS_DIR = "chats";
export const GEMINI_CLI_EXTENSIONS_DIR = "extensions";
export const GEMINI_CLI_EXTENSION_FILE = "gemini-extension.json";
export const GEMINI_CLI_HOOKS_FILE = "hooks/hooks.json";
export const GEMINI_CLI_HOOKS_POINTER = "/hooks";
export const GEMINI_CLI_JSONL_SUFFIX = ".jsonl";
export const GEMINI_CLI_JSON_SUFFIX = ".json";
export const GEMINI_CLI_CHAT_SUFFIX_PATTERN: RegExp = /\.jsonl?$/;
export const GEMINI_CLI_MESSAGE_TYPE = "gemini";
export const GEMINI_CLI_ACP_ARGS: readonly string[] = ["--experimental-acp"];
export const GEMINI_CLI_ACP_ENV: readonly string[] = ["GEMINI_*", "GOOGLE_*"];
