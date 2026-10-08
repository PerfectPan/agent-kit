import type { AcpProfile } from "../value-objects/acp-profile.js";
import type { PromptBlock } from "../value-objects/prompt-block.js";

/** What a caller gives a new or loaded session besides its directory and MCP servers. */
export interface SessionSetup {
  readonly systemPrompt?: string;
  /** Extra `_meta` fields of `session/new` and `session/load`, such as `claudeCode` for claude-agent-acp. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** The `_meta` of `session/new` and `session/load`: the caller's fields, plus the system prompt where the agent reads it. */
export function sessionMeta(
  profile: Pick<AcpProfile, "systemPrompt">,
  setup: SessionSetup
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = { ...setup.meta };
  if (setup.systemPrompt && profile.systemPrompt.in === "meta") {
    meta[profile.systemPrompt.key] = setup.systemPrompt;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * The blocks of a new session's first prompt: for an agent without a system prompt channel, the system prompt goes
 * first. A loaded session already has it in its history.
 */
export function firstPromptBlocks(
  profile: Pick<AcpProfile, "systemPrompt">,
  blocks: readonly PromptBlock[],
  setup: SessionSetup
): readonly PromptBlock[] {
  return setup.systemPrompt && profile.systemPrompt.in === "first-block"
    ? [{ type: "text", text: setup.systemPrompt }, ...blocks]
    : blocks;
}
