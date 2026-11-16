import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// DimCode (DimAgent, npm `dimcode`, binary `dim`, https://dimagent.com). Verified on 0.5.27 by installing and
// inspecting the CLI: `dim acp` serves ACP v1, `dim exec` runs headless, and the v2 data root is a SQLite database.

/** @public */
export const DIM_ID = "dim";
/** @public */
export const DIM_DISPLAY_NAME = "DimCode";
/** @public */
export const DIM_COMMAND = "dim";
/** @public */
export const HOME_DIR = ".dimcode";
/** @public */
export const HOME_SUBDIR = "v2";
// The override names a base directory under which DimCode appends `v2`, like GEMINI_CLI_HOME does for Gemini.
/** @public */
export const HOME_ENV = "DIMCODE_HOME";
/** @public */
export const DIM_HOME: HomeRule = { envVar: HOME_ENV, envSubpath: [HOME_SUBDIR], defaultPath: [HOME_DIR, HOME_SUBDIR] };
/** @public */
export const DIM_DATABASE = "dimcode.sqlite";
/** @public */
export const DIM_WAL_SUFFIX = "-wal";
/** @public */
export const DIM_CONFIG_FILE = "config.json";
/** @public */
export const DIM_PROVIDERS_FILE = "providers.json";
/** @public */
export const DIM_AUTH_FILE = "auth.json";
/** @public */
export const DIM_HOOKS_FILE = "hooks.json";
/** @public */
export const DIM_HOOKS_POINTER = "/hooks";
/** @public */
export const DIM_HOOK_FORMAT = "json";
/** @public */
export const DIM_HOOK_LAYOUT = "grouped";
/** @public */
export const DIM_SKILLS_DIR = "skills";
/** @public */
export const DIM_DATABASE_BELOW_HOME: string = `${DIM_DATABASE}`;
// The provider catalog's `environmentVariableName`s the CLI reads beside its stored credentials.
/** @public */
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
/** @public */
export const DIM_ACP_ARGS: readonly string[] = ["acp"];
/** @public */
export const DIM_ACP_ENV: readonly string[] = ["DIMCODE_*", ...DIM_API_KEY_ENVS];

/** @public */
export const agentMarkers: readonly string[] = [DIM_ID, DIM_COMMAND, HOME_DIR, HOME_ENV];
