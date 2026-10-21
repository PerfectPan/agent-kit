export const CLAUDE_CODE_ID = "claude-code";
export const CLAUDE_CODE_DISPLAY_NAME = "Claude Code";
export const CLAUDE_CODE_COMMAND = "claude";
export const CLAUDE_CODE_HOME_DIR = ".claude";
export const HOME_ENV = "CLAUDE_CONFIG_DIR";
// The override names the configuration directory itself.
export const CLAUDE_CODE_HOME: { readonly envVar: string; readonly defaultPath: readonly string[] } = {
  envVar: HOME_ENV,
  defaultPath: [CLAUDE_CODE_HOME_DIR]
};
export const CLAUDE_CODE_PROJECTS_DIR = "projects";
export const CLAUDE_CODE_CREDENTIALS_FILE = ".credentials.json";
export const CLAUDE_CODE_GLOBAL_CONFIG = "~/.claude.json";
export const CLAUDE_CODE_AUTH_ARGS: readonly string[] = ["auth", "status", "--json"];
export const CLAUDE_CODE_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export const CLAUDE_CODE_API_KEY_ENV = "ANTHROPIC_API_KEY";
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
export const CLAUDE_CODE_SESSION_ENV = "CLAUDE_CODE_SESSION_ID";
export const CLAUDE_CODE_SETTINGS_FILE = "settings.json";
export const CLAUDE_CODE_SKILLS_DIR = "skills";
export const CLAUDE_CODE_PLUGIN_MANIFEST = ".claude-plugin/plugin.json";
export const CLAUDE_CODE_PLUGIN_HOOKS = "hooks/hooks.json";
export const CLAUDE_CODE_HOOKS_POINTER = "/hooks";
export const CLAUDE_CODE_HOOK_FORMAT = "json";
export const CLAUDE_CODE_HOOK_LAYOUT = "grouped";
export const CLAUDE_CODE_SETTINGS_PATH: string = `~/${CLAUDE_CODE_HOME_DIR}/${CLAUDE_CODE_SETTINGS_FILE}`;
export const CLAUDE_CODE_SUBAGENTS_DIR = "subagents";
export const CLAUDE_CODE_SESSION_SUFFIX = ".jsonl";
export const CLAUDE_CODE_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;
export const CLAUDE_CODE_META_SUFFIX = ".meta.json";
export const CLAUDE_CODE_AGENT_FILE_START = "agent";
export const CLAUDE_CODE_AGENT_FILE_PREFIX: string = `${CLAUDE_CODE_AGENT_FILE_START}-`;
export const CLAUDE_CODE_ACP_COMMAND = "claude-agent-acp";
export const CLAUDE_CODE_ACP_ENV: readonly string[] = [
  "ANTHROPIC_*",
  "CLAUDE_*",
  "AWS_*",
  "CLOUD_ML_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS"
];

/** Agent-specific values forbidden in context source; generic path segments are deliberately excluded. */
export const agentMarkers: readonly string[] = [CLAUDE_CODE_ID, CLAUDE_CODE_COMMAND, CLAUDE_CODE_HOME_DIR, HOME_ENV];
