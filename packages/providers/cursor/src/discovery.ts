import * as z from "zod/mini";

import type { AuthReading, CommandOutput, ProbeRecipe } from "@rivus/agent-kit-discovery/spi";

import {
  CURSOR_ID,
  CURSOR_DISPLAY_NAME,
  CURSOR_AGENT_COMMAND,
  CURSOR_APP_PATH,
  CURSOR_CONFIG_PATHS,
  CURSOR_CREDENTIAL_PATHS
} from "./facts.js";

const Status = z.object({ status: z.string() });

/**
 * Reads `cursor-agent status --format json`. It exits with 0 whether or not anyone is logged in, so only the
 * output's `status` counts: `authenticated`, `partially-authenticated` (no refresh token yet) or `unauthenticated`.
 */
function parseCursorAgentStatus(output: CommandOutput): AuthReading | undefined {
  let json: unknown;
  try {
    json = JSON.parse(output.stdout);
  } catch {
    return undefined;
  }
  const parsed = Status.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  switch (parsed.data.status) {
    case "authenticated":
    case "partially-authenticated":
      return { loggedIn: true };
    case "unauthenticated":
      return { loggedIn: false };
    default:
      return undefined;
  }
}

export const cursorProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: CURSOR_ID,
  displayName: CURSOR_DISPLAY_NAME,
  kind: "app",
  commands: [CURSOR_ID, CURSOR_AGENT_COMMAND],
  appPaths: [CURSOR_APP_PATH],
  configPaths: CURSOR_CONFIG_PATHS,
  mcpConfigPaths: [],
  auth: {
    command: {
      command: CURSOR_AGENT_COMMAND,
      args: ["status", "--format", "json"],
      parse: parseCursorAgentStatus,
      sideEffects: ["Calls Cursor's servers to look up the account when tokens are stored."]
    },
    // The CLI's login on Linux and Windows; on macOS it is in the system keychain.
    credentialFiles: CURSOR_CREDENTIAL_PATHS.map((path) => ({ path }))
  },
  warnings: [
    "The CLI's other command name, agent, is not probed, because other agents install a command with that name.",
    "CURSOR_CONFIG_DIR and XDG_CONFIG_HOME overrides of the CLI's directories are not followed."
  ]
};
