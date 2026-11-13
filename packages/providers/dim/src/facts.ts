import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// DimCode (DimAgent, npm `dimcode`, binary `dim`, https://dimagent.com). Verified on 0.5.27 by installing and
// inspecting the CLI: `dim acp` serves ACP v1, `dim exec` runs headless, and the v2 data root is a SQLite database.

export const DIM_ID = "dim";
export const DIM_DISPLAY_NAME = "DimCode";
export const DIM_COMMAND = "dim";
export const HOME_DIR = ".dimcode";
export const HOME_SUBDIR = "v2";
// The override names a base directory under which DimCode appends `v2`, like GEMINI_CLI_HOME does for Gemini.
export const HOME_ENV = "DIMCODE_HOME";
export const DIM_HOME: HomeRule = { envVar: HOME_ENV, envSubpath: [HOME_SUBDIR], defaultPath: [HOME_DIR, HOME_SUBDIR] };
export const DIM_DATABASE = "dimcode.sqlite";
export const DIM_WAL_SUFFIX = "-wal";
export const DIM_CONFIG_FILE = "config.json";
export const DIM_PROVIDERS_FILE = "providers.json";
export const DIM_AUTH_FILE = "auth.json";
export const DIM_HOOKS_FILE = "hooks.json";
export const DIM_HOOKS_POINTER = "/hooks";
export const DIM_HOOK_FORMAT = "json";
export const DIM_HOOK_LAYOUT = "grouped";
export const DIM_SKILLS_DIR = "skills";
export const DIM_DATABASE_BELOW_HOME: string = `${DIM_DATABASE}`;
// The provider catalog's `environmentVariableName`s the CLI reads beside its stored credentials.
export const DIM_API_KEY_ENVS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MOONSHOT_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AZURE_API_KEY",
  "AIHUBMIX_API_KEY"
];
export const DIM_ACP_ARGS: readonly string[] = ["acp"];
export const DIM_ACP_ENV: readonly string[] = ["DIMCODE_*", ...DIM_API_KEY_ENVS];

export const agentMarkers: readonly string[] = [DIM_ID, DIM_COMMAND, HOME_DIR, HOME_ENV];
