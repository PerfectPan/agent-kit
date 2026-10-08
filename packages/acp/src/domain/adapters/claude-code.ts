import type { AcpProfile } from "../acp-session/index.js";
import { BASE_ENV } from "./base-env.js";

/**
 * claude-agent-acp, the ACP adapter around the Claude Agent SDK (npm `@agentclientprotocol/claude-agent-acp`).
 * `_meta.systemPrompt` replaces the SDK's system prompt and `_meta.claudeCode.options` passes SDK options such as
 * `disallowedTools`; both were checked against adapter 0.81.0.
 */
export const claudeCodeAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "claude-code",
  command: "claude-agent-acp",
  args: [],
  env: [...BASE_ENV, "ANTHROPIC_*", "CLAUDE_*", "AWS_*", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS"],
  systemPrompt: { in: "meta", key: "systemPrompt" },
  warnings: []
};
