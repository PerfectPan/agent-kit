import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { GEMINI_CLI_ID, GEMINI_CLI_COMMAND, GEMINI_CLI_ACP_ARGS, GEMINI_CLI_ACP_ENV } from "./facts.js";

export const geminiCliAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: GEMINI_CLI_ID,
  command: GEMINI_CLI_COMMAND,
  args: GEMINI_CLI_ACP_ARGS,
  env: [...BASE_ENV, ...GEMINI_CLI_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: the ACP flag is --experimental-acp; newer releases may name it differently",
    "unverified: Gemini CLI reads no system prompt from ACP _meta"
  ]
};
