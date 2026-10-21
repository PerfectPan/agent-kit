import { CODEX_ID, CODEX_ACP_COMMAND, CODEX_ACP_ENV } from "./facts.js";
import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";

/**
 * codex-acp (npm `@zed-industries/codex-acp`). Version 1.13.0 has no system prompt channel, so the system prompt
 * opens the first prompt; of the MCP transports it supports HTTP besides stdio.
 */
export const codexAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: CODEX_ID,
  command: CODEX_ACP_COMMAND,
  args: [],
  env: [...BASE_ENV, ...CODEX_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: []
};
