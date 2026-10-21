import {
  CODEX_ID,
  CODEX_DISPLAY_NAME,
  CODEX_COMMAND,
  CODEX_SESSIONS_DIR,
  CODEX_ARCHIVED_SESSIONS_DIR,
  CODEX_AUTH_FILE,
  CODEX_AUTH_ARGS
} from "./facts.js";
import { type AuthReading, type CommandOutput, type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import * as z from "zod/mini";

/** What follows `Logged in using ` in `codex login status`, by login method. */
const STATUS_METHODS: ReadonlyMap<string, string> = new Map([
  ["ChatGPT", "chatgpt"],
  ["an API key", "api-key"],
  ["access token", "access-token"],
  ["personal access token", "personal-access-token"],
  ["Amazon Bedrock API key", "bedrock-api-key"],
  ["Amazon Bedrock AWS access keys", "bedrock-access-keys"],
  ["workload identity", "workload-identity"]
]);

/** `auth_mode` values of `auth.json`, by the same method names. */
const FILE_METHODS: ReadonlyMap<string, string> = new Map([
  ["apikey", "api-key"],
  ["chatgpt", "chatgpt"],
  ["chatgptAuthTokens", "chatgpt"],
  ["agentIdentity", "access-token"],
  ["personalAccessToken", "personal-access-token"],
  ["bedrockApiKey", "bedrock-api-key"],
  ["bedrockAccessKeys", "bedrock-access-keys"]
]);

/** The credential fields of `auth.json`; only whether each is set is used, never its value. */
const CREDENTIAL_FIELDS = [
  "OPENAI_API_KEY",
  "tokens",
  "agent_identity",
  "personal_access_token",
  "bedrock_api_key",
  "bedrock_access_keys"
];

const AuthFile = z.looseObject({ auth_mode: z.optional(z.nullable(z.string())) });

/**
 * Reads `codex login status`, which prints one line to standard error: `Logged in using <method>` with exit code 0,
 * or `Not logged in` with exit code 1. The API key line also shows part of the key, so only the method is kept.
 */
export function parseCodexLoginStatus(output: CommandOutput): AuthReading | undefined {
  const lines = `${output.stdout}\n${output.stderr}`.split("\n").map((line) => line.trim());
  if (lines.includes("Not logged in")) {
    return { loggedIn: false };
  }
  const line = lines.find((candidate) => candidate.startsWith("Logged in using "));
  if (output.code !== 0 || line === undefined) {
    return undefined;
  }
  const method = STATUS_METHODS.get(line.slice("Logged in using ".length).split(" - ")[0] ?? "");
  return method === undefined ? { loggedIn: true } : { loggedIn: true, method };
}

/** Reads `$CODEX_HOME/auth.json`: `auth_mode` names the method; the credentials are only checked for presence. */
export function parseCodexAuthFile(json: unknown): AuthReading | undefined {
  const parsed = AuthFile.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const record = parsed.data as Readonly<Record<string, unknown>>;
  const loggedIn = CREDENTIAL_FIELDS.some((field) => record[field] !== undefined && record[field] !== null);
  const method = parsed.data.auth_mode ? FILE_METHODS.get(parsed.data.auth_mode) : undefined;
  return loggedIn && method !== undefined ? { loggedIn, method } : { loggedIn };
}

export const codexProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: CODEX_ID,
  displayName: CODEX_DISPLAY_NAME,
  kind: "cli",
  commands: [CODEX_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: CODEX_ID, path: CODEX_SESSIONS_DIR },
    { agentHome: CODEX_ID, path: CODEX_ARCHIVED_SESSIONS_DIR },
    { agentHome: CODEX_ID, path: CODEX_AUTH_FILE }
  ],
  mcpConfigPaths: [],
  version: { ...VERSION_FLAG, sideEffects: ["Creates $CODEX_HOME/tmp/arg0, as every codex run does."] },
  auth: {
    command: {
      args: CODEX_AUTH_ARGS,
      parse: parseCodexLoginStatus,
      sideEffects: [
        "Creates $CODEX_HOME/tmp/arg0, as every codex run does.",
        "With a personal access token, agent identity or workload identity login, calls OpenAI's servers."
      ]
    },
    // Absent when Codex keeps credentials in the system keyring.
    credentialFiles: [{ path: { agentHome: CODEX_ID, path: CODEX_AUTH_FILE }, parse: parseCodexAuthFile }]
  },
  warnings: []
};
