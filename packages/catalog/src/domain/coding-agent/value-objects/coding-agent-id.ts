/** Built-in agents whose home directory rule is verified against upstream sources; `resolveHome` takes these. */
export type CodingAgentIdWithHome =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "grok"
  | "opencode"
  | "pi"
  | "cline"
  | "codebuddy"
  | "codex-desktop"
  | "github-copilot"
  | "kimi-code-cli"
  | "kiro-cli"
  | "neovate"
  | "openhands"
  | "qoder";

/** Ids of the coding agents the kit knows. Each has an identity in `catalog/src/agents/`. */
export type BuiltinCodingAgentId =
  | CodingAgentIdWithHome
  | "aider"
  | "amp"
  | "antigravity"
  | "command-code"
  | "cursor"
  | "hermes"
  | "openclaw"
  | "roo-code"
  | "trae"
  | "vscode-copilot"
  | "windsurf"
  | "zencoder";

/**
 * A built-in id, or the id of a third-party agent whose adapters a caller passes to a use case. The `string & {}`
 * member accepts any id while keeping editor completion for the built-in ones; `parseCodingAgentId` resolves
 * aliases and checks the shape.
 */
export type CodingAgentId = BuiltinCodingAgentId | (string & {});

/** The canonical id of a known CodingAgent, or a third-party id: lowercase letters and digits in `-`-joined words. */
export const CODING_AGENT_ID_PATTERN: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface InvalidCodingAgentId {
  readonly _tag: "InvalidCodingAgentId";
  readonly input: string;
}
