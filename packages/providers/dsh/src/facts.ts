import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const DSH_ID = "dsh";
export const DSH_DISPLAY_NAME = "DeepSeek Harness";
export const HOME_ENV = "DSH_HOME";
// The override names the harness home itself, not a parent directory.
export const DSH_HOME: HomeRule = { envVar: HOME_ENV, expandsTilde: true, defaultPath: [".dsh"] };
export const DSH_SESSIONS_DIR = "sessions";
/** The session format generation this adapter reads. */
export const DSH_SESSION_VERSION = 4;

/** The npm package `@deepseek-ai/dsh` installs this command. */
export const DSH_COMMAND = "dsh";
/** The profile that serves ACP v1 over stdio. */
export const DSH_ACP_ARGS: readonly string[] = ["--profile", "acp"];
/**
 * Known launch settings for the built-in ACP profile and DeepSeek API. Internal subprocess markers and the
 * speech worker's generated token are excluded. User-configured pi-ai `apiKeyEnv` names are not enumerable;
 * callers must explicitly forward a referenced key only when it is available solely in their own environment.
 */
export const DSH_ACP_ENV: readonly string[] = [
  HOME_ENV,
  "DSH_AGENTS_HOME",
  "DSH_BUNDLED_SKILL_DIR",
  "DSH_PERMISSION_MODE",
  "DSH_TELEMETRY_DISABLED",
  "DSH_TELEMETRY_MODE",
  "DSH_TELEMETRY_OTLP_URL",
  "DSH_WEB_SEARCH_PROVIDER",
  "DSH_WEB_FETCH_PROVIDER",
  "DEEPSEEK_*"
];
/** Where `dsh` stores the API key a login saves, under `refs.DEEPSEEK_API_KEY`; YAML, so never parsed here. */
export const DSH_CREDENTIAL_FILE = ".credentials.yaml";
/** The variable the stored credential is named after; the launch environment's value is a fallback to the file. */
export const DSH_API_KEY_ENV = "DEEPSEEK_API_KEY";

export const agentMarkers: readonly string[] = [DSH_ID, ".dsh", HOME_ENV];
