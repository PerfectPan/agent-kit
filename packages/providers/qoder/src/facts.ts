import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

// Qoder CLI (https://qoder.com/cli), installed by `curl -fsSL https://qoder.com/install | bash` into `~/.qoder/bin`
// with the `qodercli` entry on `PATH`. Its settings, hooks and payload follow Claude Code's shapes (the CLI even
// ships `qodercli hooks migrate` from Claude Code), per its agent SDK's protocol types
// (npm `@qoder-ai/qoder-agent-sdk`, dist/types/{hooks,settings}.d.ts) and the binary strings.

export const QODER_ID = "qoder";
export const QODER_DISPLAY_NAME = "Qoder CLI";
// The entry point the installer puts on PATH; the versioned binary lives under `~/.qoder/bin/qodercli/`.
export const QODER_COMMAND = "qodercli";
export const HOME_DIR = ".qoder";
// QODER_CONFIG_DIR relocates the user-level config root (verified against the binary strings; `QODER_USER_CONFIG_DIR`
// also appears there).
export const HOME_ENV = "QODER_CONFIG_DIR";
export const QODER_HOME: HomeRule = { envVar: HOME_ENV, defaultPath: [HOME_DIR] };
export const QODER_SETTINGS_FILE = "settings.json";
export const QODER_SETTINGS_PATH: string = `~/${HOME_DIR}/${QODER_SETTINGS_FILE}`;
export const QODER_HOOKS_POINTER = "/hooks";
export const QODER_HOOK_FORMAT = "json";
export const QODER_HOOK_LAYOUT = "grouped";
// Project settings live in the workspace under `.qoder/`, beside `settings.local.json`.
export const QODER_PROJECT_SETTINGS_DIR = ".qoder";
export const QODER_OAUTH_FILE = "oauth_creds.json";
export const QODER_PAT_ENV = "QODER_PERSONAL_ACCESS_TOKEN";
export const QODER_ACP_ARGS: readonly string[] = ["--acp"];
export const QODER_ACP_ENV: readonly string[] = ["QODER_*", "DASHSCOPE_API_KEY"];

export const agentMarkers: readonly string[] = [QODER_ID, QODER_COMMAND, HOME_DIR, HOME_ENV];
