import type { AcpProfile } from "../acp-session/index.js";
import { BASE_ENV } from "./base-env.js";

/**
 * codex-acp (npm `@zed-industries/codex-acp`). Version 1.13.0 has no system prompt channel, so the system prompt
 * opens the first prompt; of the MCP transports it supports HTTP besides stdio.
 */
export const codexAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "codex",
  command: "codex-acp",
  args: [],
  env: [...BASE_ENV, "OPENAI_*", "CODEX_*", "AZURE_OPENAI_*"],
  systemPrompt: { in: "first-block" },
  warnings: []
};
