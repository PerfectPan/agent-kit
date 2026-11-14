import type { CodingAgentId, ServiceTable } from "@rivus/agent-kit-catalog/public";

/**
 * Where a system prompt goes: under `_meta[key]` of `session/new` and `session/load`, or as a text block before the
 * first prompt of a new session, for agents that have no channel for it.
 */
export type SystemPromptPlacement = { readonly in: "meta"; readonly key: string } | { readonly in: "first-block" };

/** How one agent is launched over ACP and how it expects `_meta` fields. */
export interface AcpProfile {
  readonly specificationVersion: "acp-v1";
  readonly agent: CodingAgentId;
  /** The agent's ACP program, found on the `PATH` of the environment the caller passes. */
  readonly command: string;
  readonly args: readonly string[];
  /**
   * The environment variables the agent reads, as exact names or patterns with one `*` (`ANTHROPIC_*`). `agentEnv`
   * copies the matching ones from an environment the caller chooses; the kit never reads the process environment.
   */
  readonly env: readonly string[];
  readonly systemPrompt: SystemPromptPlacement;
  /**
   * Whether the agent keeps every session of one connection running while a new one starts: `"multi"` (the default)
   * keeps them, `"single"` marks agents whose adapter closes the others — for those, `newSession` and `loadSession`
   * refuse with `TurnActive` while another session of the connection runs a turn, because the closed session could
   * never settle it.
   */
  readonly sessions?: "multi" | "single";
  /** Facts about this agent that are not verified against its source or documentation. */
  readonly warnings: readonly string[];
}

export type AcpProfiles = ServiceTable<AcpProfile>;
