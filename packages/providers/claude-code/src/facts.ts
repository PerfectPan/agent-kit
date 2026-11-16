import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const CLAUDE_CODE_ID = "claude-code";
/** @public */
export const CLAUDE_CODE_DISPLAY_NAME = "Claude Code";
/** @public */
export const CLAUDE_CODE_COMMAND = "claude";
/** @public */
export const CLAUDE_CODE_HOME_DIR = ".claude";
/** @public */
export const HOME_ENV = "CLAUDE_CONFIG_DIR";
// The override names the configuration directory itself.
/** @public */
export const CLAUDE_CODE_HOME: HomeRule = {
  envVar: HOME_ENV,
  defaultPath: [CLAUDE_CODE_HOME_DIR]
};
/** @public */
export const CLAUDE_CODE_PROJECTS_DIR = "projects";
/** @public */
export const CLAUDE_CODE_CREDENTIALS_FILE = ".credentials.json";
/** @public */
export const CLAUDE_CODE_GLOBAL_CONFIG = "~/.claude.json";
/** @public */
export const CLAUDE_CODE_AUTH_ARGS: readonly string[] = ["auth", "status", "--json"];
/** @public */
export const CLAUDE_CODE_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
/** @public */
export const CLAUDE_CODE_API_KEY_ENV = "ANTHROPIC_API_KEY";
/** @public */
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
/** @public */
export const CLAUDE_CODE_SESSION_ENV = "CLAUDE_CODE_SESSION_ID";
/** @public */
export const CLAUDE_CODE_SETTINGS_FILE = "settings.json";
/** @public */
export const CLAUDE_CODE_SKILLS_DIR = "skills";
/** @public */
export const CLAUDE_CODE_PLUGIN_MANIFEST = ".claude-plugin/plugin.json";
/** @public */
export const CLAUDE_CODE_PLUGIN_HOOKS = "hooks/hooks.json";
/** @public */
export const CLAUDE_CODE_HOOKS_POINTER = "/hooks";
/** @public */
export const CLAUDE_CODE_HOOK_FORMAT = "json";
/** @public */
export const CLAUDE_CODE_HOOK_LAYOUT = "grouped";
/** @public */
export const CLAUDE_CODE_SETTINGS_PATH: string = `~/${CLAUDE_CODE_HOME_DIR}/${CLAUDE_CODE_SETTINGS_FILE}`;
/** @public */
export const CLAUDE_CODE_SUBAGENTS_DIR = "subagents";
/** @public */
export const CLAUDE_CODE_SESSION_SUFFIX = ".jsonl";
/** @public */
export const CLAUDE_CODE_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;
/** @public */
export const CLAUDE_CODE_META_SUFFIX = ".meta.json";
/** @public */
export const CLAUDE_CODE_AGENT_FILE_START = "agent";
/** @public */
export const CLAUDE_CODE_AGENT_FILE_PREFIX: string = `${CLAUDE_CODE_AGENT_FILE_START}-`;
/** @public */
export const CLAUDE_CODE_ACP_COMMAND = "claude-agent-acp";
/** @public */
export const CLAUDE_CODE_ACP_ENV: readonly string[] = [
  "ANTHROPIC_*",
  "CLAUDE_*",
  "AWS_*",
  "CLOUD_ML_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS"
];

/** @public */
export const agentMarkers: readonly string[] = [CLAUDE_CODE_ID, CLAUDE_CODE_COMMAND, CLAUDE_CODE_HOME_DIR, HOME_ENV];
