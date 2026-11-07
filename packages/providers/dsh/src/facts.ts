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
 * The variables the harness reads from its launch environment: its own settings, without the markers it sets for its
 * own subprocesses (`DSH_SUBPROCESS_CONTROL`, `DSH_SUBPROCESS_RUNNER`), and DeepSeek's API settings, such as
 * `DEEPSEEK_BASE_URL`, which only the launch environment may set.
 */
export const DSH_ACP_ENV: readonly string[] = [
  HOME_ENV,
  "DSH_AGENTS_HOME",
  "DSH_TELEMETRY_DISABLED",
  "DSH_TELEMETRY_MODE",
  "DSH_TELEMETRY_OTLP_URL",
  "DSH_WEB_SEARCH_PROVIDER",
  "DSH_WEB_FETCH_PROVIDER",
  "DSH_SPEECH_TOKEN",
  "DEEPSEEK_*"
];
/** Where `dsh` stores the API key a login saves, under `refs.DEEPSEEK_API_KEY`; YAML, so never parsed here. */
export const DSH_CREDENTIAL_FILE = ".credentials.yaml";
/** The variable the stored credential is named after; the launch environment's value is a fallback to the file. */
export const DSH_API_KEY_ENV = "DEEPSEEK_API_KEY";

export const agentMarkers: readonly string[] = [DSH_ID, ".dsh", HOME_ENV];
