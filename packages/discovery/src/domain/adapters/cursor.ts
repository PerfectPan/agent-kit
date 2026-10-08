import * as z from "zod/mini";

import type { AuthReading, CommandOutput, ProbeRecipe } from "../installation/index.js";

const Status = z.object({ status: z.string() });

/**
 * Reads `cursor-agent status --format json`. It exits with 0 whether or not anyone is logged in, so only the
 * output's `status` counts: `authenticated`, `partially-authenticated` (no refresh token yet) or `unauthenticated`.
 */
export function parseCursorAgentStatus(output: CommandOutput): AuthReading | undefined {
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
  agent: "cursor",
  displayName: "Cursor",
  kind: "app",
  commands: ["cursor", "cursor-agent"],
  appPaths: ["/Applications/Cursor.app"],
  configPaths: [
    "~/Library/Application Support/Cursor/User",
    "~/.config/Cursor/User",
    "~/AppData/Roaming/Cursor/User",
    "~/.cursor"
  ],
  mcpConfigPaths: ["~/.cursor/mcp.json", "~/Library/Application Support/Cursor/User/mcp.json"],
  auth: {
    command: {
      command: "cursor-agent",
      args: ["status", "--format", "json"],
      parse: parseCursorAgentStatus,
      sideEffects: ["Calls Cursor's servers to look up the account when tokens are stored."]
    },
    // The CLI's login on Linux and Windows; on macOS it is in the system keychain.
    credentialFiles: [{ path: "~/.config/cursor/auth.json" }, { path: "~/AppData/Roaming/Cursor/auth.json" }]
  },
  warnings: [
    "The CLI's other command name, agent, is not probed, because other agents install a command with that name.",
    "CURSOR_CONFIG_DIR and XDG_CONFIG_HOME overrides of the CLI's directories are not followed."
  ]
};
