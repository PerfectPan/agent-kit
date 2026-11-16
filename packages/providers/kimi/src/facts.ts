import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// https://www.kimi.com/code/docs/en/kimi-code-cli/ (getting started, data locations, env vars, providers, hooks,
// and the `kimi acp` reference).

/** @public */
export const KIMI_ID = "kimi";
/** @public */
export const KIMI_DISPLAY_NAME = "Kimi Code";
/** @public */
export const HOME_DIR = ".kimi-code";
// The override names the data root itself, rather than its parent.
/** @public */
export const HOME_ENV = "KIMI_CODE_HOME";
/** @public */
export const KIMI_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
/** @public */
export const KIMI_CONFIG_FILE = "config.toml";
/** @public */
export const KIMI_MCP_FILE = "mcp.json";
/** @public */
export const KIMI_SESSIONS_DIR = "sessions";
/** @public */
export const KIMI_SESSION_INDEX_FILE = "session_index.jsonl";
/** @public */
export const KIMI_SESSION_STATE_FILE = "state.json";
/** @public */
export const KIMI_SESSION_WIRE_FILE = "agents/main/wire.jsonl";
/** @public */
export const KIMI_CREDENTIALS_DIR = "credentials";
/** @public */
export const KIMI_CONFIG_PATH: string = `~/${HOME_DIR}/${KIMI_CONFIG_FILE}`;
// Hooks are `[[hooks]]` entries of the user config, each carrying its event in an `event` field; there is no
// project-level hook file.
/** @public */
export const KIMI_HOOKS_POINTER = "/hooks";
/** @public */
export const KIMI_HOOK_FORMAT = "toml";
/** @public */
export const KIMI_HOOK_LAYOUT = "event-list";
/** @public */
export const KIMI_HOOK_MEMBER_KEYS: readonly string[] = ["event", "command"];
// The one payload field only Kimi's hooks carry (see the hooks guide's event data format).
/** @public */
export const KIMI_CLIENT_TYPE_FIELD = "client_type";
/** @public */
export const KIMI_CLIENT_TYPE = "kimi_code_cli";
// Kimi reads keys from config.toml, never from the environment, except the temporary KIMI_MODEL_* provider.
/** @public */
export const KIMI_MODEL_API_KEY_ENV = "KIMI_MODEL_API_KEY";
/** @public */
export const KIMI_ACP_ARGS: readonly string[] = ["acp"];
/** @public */
export const KIMI_ACP_ENV: readonly string[] = ["KIMI_*"];

/** @public */
export const agentMarkers: readonly string[] = [KIMI_ID, HOME_DIR, HOME_ENV];
