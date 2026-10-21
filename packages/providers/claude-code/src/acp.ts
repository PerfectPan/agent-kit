import { CLAUDE_CODE_ID, CLAUDE_CODE_ACP_COMMAND, CLAUDE_CODE_ACP_ENV } from "./facts.js";
import type { AcpProfile } from "@rivus/agent-kit-acp/spi";
import { BASE_ENV } from "@rivus/agent-kit-acp/spi";

/**
 * claude-agent-acp, the ACP adapter around the Claude Agent SDK (npm `@agentclientprotocol/claude-agent-acp`).
 * `_meta.systemPrompt` replaces the SDK's system prompt and `_meta.claudeCode.options` passes SDK options such as
 * `disallowedTools`; both were checked against adapter 0.81.0.
 */
export const claudeCodeAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: CLAUDE_CODE_ID,
  command: CLAUDE_CODE_ACP_COMMAND,
  args: [],
  env: [...BASE_ENV, ...CLAUDE_CODE_ACP_ENV],
  systemPrompt: { in: "meta", key: "systemPrompt" },
  warnings: []
};
