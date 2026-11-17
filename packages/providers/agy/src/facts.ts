import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// Google Antigravity CLI (`agy`, https://antigravity.google), a Go binary installed at `~/.local/bin/agy` that
// serves the Agent Client Protocol over stdio through `agy acp`. Its files live in the Gemini directory
// `~/.gemini` — the `--gemini-dir` flag (default `.gemini`) and the `ANTIGRAVITY_GEMINI_DIR` variable (binary
// strings) relocate it — with the CLI's own state under `~/.gemini/antigravity-cli` (`--app-data-dir`, default
// `antigravity-cli`; `ANTIGRAVITY_APP_DATA_DIR` also appears in the binary strings). Conversations are one SQLite
// database per conversation of protobuf payloads (`antigravity-cli/conversations/<uuid>.db`, no published schema)
// beside a relational summaries database and a `history.jsonl` of prompts; hooks are named entries in `hooks.json`
// files (`hook_event_name`, `PreToolUse`/`PostToolUse`/`SessionStart` appear in the binary) whose schema the CLI
// does not document.

export const AGY_ID = "agy";
export const AGY_DISPLAY_NAME = "Antigravity CLI";
/** @public */
export const AGY_COMMAND = "agy";
/** @public */
export const AGY_APP_DATA_DIR = "antigravity-cli";
/** @public */
export const HOME_DIR = ".gemini";
// ANTIGRAVITY_GEMINI_DIR relocates the Gemini directory the way `--gemini-dir` does; the value names the directory
// itself, like the flag default `.gemini`.
/** @public */
export const HOME_ENV = "ANTIGRAVITY_GEMINI_DIR";
export const AGY_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
export const AGY_CLI_SETTINGS_FILE = "antigravity-cli/settings.json";
export const AGY_ONBOARDING_STATE_FILE = "antigravity-cli/jetski_state.pbtxt";
export const AGY_HISTORY_FILE = "antigravity-cli/history.jsonl";
export const AGY_ACP_ARGS: readonly string[] = ["acp"];
// The CLI reads Google-credential variables beside its own `AGY_*` and `ANTIGRAVITY_*` families (binary strings).
export const AGY_ACP_ENV: readonly string[] = ["AGY_*", "ANTIGRAVITY_*", "GEMINI_*", "GOOGLE_*"];

/** @public */
export const agentMarkers: readonly string[] = [AGY_ID, AGY_COMMAND, AGY_APP_DATA_DIR, HOME_ENV];
