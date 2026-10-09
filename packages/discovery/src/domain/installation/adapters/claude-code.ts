import * as z from "zod/mini";

import type { AuthReading, CommandOutput, ProbeRecipe } from "../index.js";
import { VERSION_FLAG } from "./version-flag.js";

const AuthStatus = z.object({ loggedIn: z.boolean(), authMethod: z.optional(z.string()) });
/** The `authMethod` values Claude Code prints. Any other value is not passed on, so the field cannot carry a secret. */
const METHODS: ReadonlySet<string> = new Set(["claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"]);
/** An `oauthAccount` counts as set when it holds a record or a list; any other value reads as absent. */
const OAuthAccount = z.catch(
  z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.undefined()]),
  undefined
);
const GlobalConfig = z.looseObject({ oauthAccount: OAuthAccount });

/**
 * Reads `claude auth status --json`, which exits with 1 when logged out. `authMethod` is `claude.ai`, `oauth_token`,
 * `api_key`, `api_key_helper`, `third_party` or `none`. Only it and `loggedIn` are kept; the rest of the output can
 * name the account.
 */
export function parseClaudeCodeAuthStatus(output: CommandOutput): AuthReading | undefined {
  let json: unknown;
  try {
    json = JSON.parse(output.stdout);
  } catch {
    return undefined;
  }
  const parsed = AuthStatus.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const { loggedIn, authMethod } = parsed.data;
  return loggedIn && authMethod !== undefined && METHODS.has(authMethod)
    ? { loggedIn, method: authMethod }
    : { loggedIn };
}

/**
 * Reads `~/.claude.json`, where a claude.ai login records its account under `oauthAccount`. Only whether that field
 * is set is used; it names the account.
 */
export function parseClaudeCodeGlobalConfig(json: unknown): AuthReading | undefined {
  const parsed = GlobalConfig.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data.oauthAccount !== undefined ? { loggedIn: true, method: "claude.ai" } : { loggedIn: false };
}

export const claudeCodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "claude-code",
  displayName: "Claude Code",
  kind: "cli",
  commands: ["claude"],
  appPaths: [],
  configPaths: [{ agentHome: "claude-code" }, "~/.claude.json"],
  mcpConfigPaths: ["~/.claude.json", { agentHome: "claude-code", path: "settings.json" }],
  version: VERSION_FLAG,
  auth: {
    command: {
      args: ["auth", "status", "--json"],
      parse: parseClaudeCodeAuthStatus,
      sideEffects: [
        "Reads the Claude Code configuration and, on macOS, the system keychain.",
        "Logs a cli_auth_status analytics event; whether it is sent over the network is unverified."
      ]
    },
    credentialFiles: [
      // Under CLAUDE_CONFIG_DIR instead when it is set, which this path does not follow.
      { path: "~/.claude.json", parse: parseClaudeCodeGlobalConfig },
      // The login on Linux and Windows, and on macOS when the keychain refused it.
      { path: { agentHome: "claude-code", path: ".credentials.json" } }
    ],
    env: [
      { name: "ANTHROPIC_AUTH_TOKEN", method: "oauth_token" },
      { name: "ANTHROPIC_API_KEY", method: "api_key" },
      { name: "CLAUDE_CODE_OAUTH_TOKEN", method: "oauth_token" }
    ]
  },
  warnings: []
};
