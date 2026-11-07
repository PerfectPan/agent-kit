import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

export const DSH_ID = "dsh";
export const DSH_DISPLAY_NAME = "DeepSeek Harness";
export const HOME_ENV = "DSH_HOME";
// The override names the harness home itself, not a parent directory.
export const DSH_HOME: HomeRule = { envVar: HOME_ENV, expandsTilde: true, defaultPath: [".dsh"] };
export const DSH_SESSIONS_DIR = "sessions";
/** The session format generation this adapter reads. */
export const DSH_SESSION_VERSION = 4;

export const agentMarkers: readonly string[] = [DSH_ID, ".dsh", HOME_ENV];
