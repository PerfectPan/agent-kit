import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const GROK_ID = "grok";
/** @public */
export const GROK_DISPLAY_NAME = "Grok";
/** @public */
export const HOME_DIR = ".grok";
/** @public */
export const HOME_ENV = "GROK_HOME";
// The override names the Grok home itself.
/** @public */
export const GROK_HOME: HomeRule = {
  envVar: HOME_ENV,
  defaultPath: [HOME_DIR]
};
/** @public */
export const GROK_SESSIONS_DIR = "sessions";
/** @public */
export const GROK_AUTH_FILE = "auth.json";
/** @public */
export const GROK_API_KEY_ENV = "XAI_API_KEY";
/** @public */
export const GROK_HOOKS_DIR = "hooks";
/** @public */
export const GROK_HOOK_SUFFIX = ".json";
/** @public */
export const GROK_UPDATES_FILE = "updates.jsonl";
/** @public */
export const GROK_EVENTS_FILE = "events.jsonl";
/** @public */
export const GROK_CHAT_HISTORY_FILE = "chat_history.jsonl";
/** @public */
export const GROK_SUMMARY_FILE = "summary.json";
/**
 * The join files read for per-call requests (`events.jsonl` and `chat_history.jsonl`) are context echoes, not
 * transcripts: a session past this size joins no calls and the translation keeps its turn-level request.
 */
/** @public */
export const GROK_CALLS_FILE_BYTES: number = 32 * 1024 * 1024;
/** @public */
export const GROK_SYSTEM_PROMPT_FILE = "system_prompt.txt";
/** @public */
export const GROK_TOOLS_FILE = "tool_definitions.json";
/** @public */
export const GROK_SUBAGENTS_DIR = "subagents";
/** @public */
export const GROK_SUBAGENT_META_FILE = "meta.json";
/** @public */
export const GROK_EVENT_FIELD = "hookEventName";
/** @public */
export const GROK_EVENT_ENV = "GROK_HOOK_EVENT";
/** @public */
export const GROK_SESSION_ENV = "GROK_SESSION_ID";
/** @public */
export const GROK_CLAUDE_AGENT = "claude-code";
/** @public */
export const GROK_CLAUDE_HOOK_FILES: readonly string[] = [
  "~/.claude/settings.json",
  "~/.claude/settings.local.json",
  ".claude/settings.json",
  ".claude/settings.local.json"
];
/** @public */
export const GROK_CURSOR_AGENT = "cursor";
/** @public */
export const GROK_CURSOR_HOOK_FILES: readonly string[] = ["~/.cursor/hooks.json", ".cursor/hooks.json"];
/** @public */
export const GROK_ACP_ARGS: readonly string[] = ["agent", "stdio"];
/** @public */
export const GROK_ACP_ENV: readonly string[] = ["GROK_*", "XAI_*"];
/** @public */
export const GROK_VERSION_SIDE_EFFECT =
  "Creates ~/.grok, or $GROK_HOME, when it does not exist, as every grok run does.";

/** @public */
export const agentMarkers: readonly string[] = [GROK_ID, HOME_DIR, HOME_ENV];
