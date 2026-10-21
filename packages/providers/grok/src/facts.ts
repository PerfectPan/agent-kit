export const GROK_ID = "grok";
export const GROK_DISPLAY_NAME = "Grok";
const HOME_DIR = ".grok";
const HOME_ENV = "GROK_HOME";
// The override names the Grok home itself.
export const GROK_HOME: { readonly envVar: string; readonly defaultPath: readonly string[] } = {
  envVar: HOME_ENV,
  defaultPath: [HOME_DIR]
};
export const GROK_SESSIONS_DIR = "sessions";
export const GROK_AUTH_FILE = "auth.json";
export const GROK_API_KEY_ENV = "XAI_API_KEY";
export const GROK_HOOKS_DIR = "hooks";
export const GROK_HOOK_SUFFIX = ".json";
export const GROK_UPDATES_FILE = "updates.jsonl";
export const GROK_SUMMARY_FILE = "summary.json";
export const GROK_SYSTEM_PROMPT_FILE = "system_prompt.txt";
export const GROK_TOOLS_FILE = "tool_definitions.json";
export const GROK_SUBAGENTS_DIR = "subagents";
export const GROK_SUBAGENT_META_FILE = "meta.json";
export const GROK_EVENT_FIELD = "hookEventName";
export const GROK_EVENT_ENV = "GROK_HOOK_EVENT";
export const GROK_SESSION_ENV = "GROK_SESSION_ID";
export const GROK_CLAUDE_AGENT = "claude-code";
export const GROK_CLAUDE_HOOK_FILES: readonly string[] = [
  "~/.claude/settings.json",
  "~/.claude/settings.local.json",
  ".claude/settings.json",
  ".claude/settings.local.json"
];
export const GROK_CURSOR_AGENT = "cursor";
export const GROK_CURSOR_HOOK_FILES: readonly string[] = ["~/.cursor/hooks.json", ".cursor/hooks.json"];
export const GROK_ACP_ARGS: readonly string[] = ["agent", "stdio"];
export const GROK_ACP_ENV: readonly string[] = ["GROK_*", "XAI_*"];
export const GROK_VERSION_SIDE_EFFECT =
  "Creates ~/.grok, or $GROK_HOME, when it does not exist, as every grok run does.";

/** Agent-specific values forbidden in context source; generic path segments are deliberately excluded. */
export const agentMarkers: readonly string[] = [GROK_ID, HOME_DIR, HOME_ENV];
