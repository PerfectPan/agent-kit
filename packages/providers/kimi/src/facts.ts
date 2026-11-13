import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// https://www.kimi.com/code/docs/en/kimi-code-cli/ (getting started, data locations, env vars, providers, hooks,
// and the `kimi acp` reference).

export const KIMI_ID = "kimi";
export const KIMI_DISPLAY_NAME = "Kimi Code";
export const HOME_DIR = ".kimi-code";
// The override names the data root itself, rather than its parent.
export const HOME_ENV = "KIMI_CODE_HOME";
export const KIMI_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
export const KIMI_CONFIG_FILE = "config.toml";
export const KIMI_MCP_FILE = "mcp.json";
export const KIMI_SESSIONS_DIR = "sessions";
export const KIMI_SESSION_INDEX_FILE = "session_index.jsonl";
export const KIMI_SESSION_STATE_FILE = "state.json";
export const KIMI_SESSION_WIRE_FILE = "agents/main/wire.jsonl";
export const KIMI_CREDENTIALS_DIR = "credentials";
export const KIMI_CONFIG_PATH: string = `~/${HOME_DIR}/${KIMI_CONFIG_FILE}`;
// Hooks are `[[hooks]]` entries of the user config, each carrying its event in an `event` field; there is no
// project-level hook file.
export const KIMI_HOOKS_POINTER = "/hooks";
export const KIMI_HOOK_FORMAT = "toml";
export const KIMI_HOOK_LAYOUT = "event-list";
export const KIMI_HOOK_MEMBER_KEYS: readonly string[] = ["event", "command"];
// The one payload field only Kimi's hooks carry (see the hooks guide's event data format).
export const KIMI_CLIENT_TYPE_FIELD = "client_type";
export const KIMI_CLIENT_TYPE = "kimi_code_cli";
// Kimi reads keys from config.toml, never from the environment, except the temporary KIMI_MODEL_* provider.
export const KIMI_MODEL_API_KEY_ENV = "KIMI_MODEL_API_KEY";
export const KIMI_ACP_ARGS: readonly string[] = ["acp"];
export const KIMI_ACP_ENV: readonly string[] = ["KIMI_*"];

export const agentMarkers: readonly string[] = [KIMI_ID, HOME_DIR, HOME_ENV];
