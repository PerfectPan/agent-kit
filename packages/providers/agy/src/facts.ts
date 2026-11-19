import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// Google Antigravity CLI (`agy`, https://antigravity.google), a Go binary installed at `~/.local/bin/agy` that
// serves the Agent Client Protocol over stdio through `agy acp`. Its files live in the Gemini directory
// `~/.gemini` — the `--gemini-dir` flag (default `.gemini`) and the `ANTIGRAVITY_GEMINI_DIR` variable (binary
// strings) relocate it — with global customizations under `~/.gemini/config/` (`hooks.json`, `plugins/<name>/`,
// `skills/<name>/SKILL.md`) and CLI runtime state under `~/.gemini/antigravity-cli`. Each conversation writes JSONL
// step transcripts to `antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (compact) and
// `transcript_full.jsonl` (untruncated), with per-step model and token counts.

export const AGY_ID = "agy";
export const AGY_DISPLAY_NAME = "Antigravity CLI";
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
export const AGY_CONFIG_DIR = "config";
export const AGY_PLUGINS_DIR = "plugins";
export const AGY_SKILLS_DIR = "skills";
export const AGY_PLUGIN_MANIFEST = "plugin.json";
export const AGY_HOOKS_FILE = "hooks.json";
export const AGY_HOOK_TIMEOUT_SECONDS = 30;
export const AGY_HOST_MARKER_FIELD = "artifactDirectoryPath";
export const AGY_BRAIN_DIR: string = `${AGY_APP_DATA_DIR}/brain`;
export const AGY_TRANSCRIPT_REL = ".system_generated/logs/transcript.jsonl";
export const AGY_TRANSCRIPT_FULL_REL = ".system_generated/logs/transcript_full.jsonl";
export const AGY_TRANSCRIPT_FILE = "transcript.jsonl";
export const AGY_ACP_ARGS: readonly string[] = ["acp"];
// The CLI reads Google-credential variables beside its own `AGY_*` and `ANTIGRAVITY_*` families (binary strings).
export const AGY_ACP_ENV: readonly string[] = ["AGY_*", "ANTIGRAVITY_*", "GEMINI_*", "GOOGLE_*"];

/** @public */
export const agentMarkers: readonly string[] = [AGY_ID, AGY_COMMAND, AGY_APP_DATA_DIR, HOME_ENV];
