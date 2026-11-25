import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// GitHub Copilot CLI (`copilot`, https://github.com/github/copilot-cli), a Node package whose native binary serves
// the Agent Client Protocol over stdio through `copilot --acp`. Its files live in the Copilot directory `~/.copilot`
// (relocated by `COPILOT_HOME`): `config.json` and `settings.json`, `mcp-config.json`, `copilot-instructions.md`,
// `hooks/*.json`, `skills/`, `agents/`, and `session-state/<session-id>/`, where each session writes its records to
// `events.jsonl`.

export const COPILOT_ID = "copilot";
export const COPILOT_DISPLAY_NAME = "GitHub Copilot CLI";
export const COPILOT_COMMAND = "copilot";
/** @public */
export const HOME_DIR = ".copilot";
/** @public */
export const HOME_ENV = "COPILOT_HOME";
export const COPILOT_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
export const COPILOT_SETTINGS_FILE = "settings.json";
export const COPILOT_CONFIG_FILE = "config.json";
export const COPILOT_MCP_CONFIG_FILE = "mcp-config.json";
export const COPILOT_SESSION_STATE_DIR = "session-state";
export const COPILOT_EVENTS_FILE = "events.jsonl";
export const COPILOT_HOOKS_DIR = "hooks";
export const COPILOT_HOOKS_SUFFIX = ".json";
// The hook configuration's `timeout` counts seconds; a hook without one stops after 30.
export const COPILOT_HOOK_TIMEOUT_SECONDS = 30;
// Every hook process Copilot CLI starts exports this variable, beside `COPILOT_PROJECT_DIR` and the CLI paths.
export const COPILOT_HOST_MARKER_ENV = "COPILOT_CLI";
export const COPILOT_ACP_ARGS: readonly string[] = ["--acp"];
// The directory variable and the tokens the CLI signs in with.
export const COPILOT_ACP_ENV: readonly string[] = [HOME_ENV, "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/** @public */
export const agentMarkers: readonly string[] = [COPILOT_ID, COPILOT_COMMAND, HOME_DIR, HOME_ENV];
