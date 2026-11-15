import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { DIM_ACP_ARGS, DIM_ACP_ENV, DIM_COMMAND, DIM_ID } from "./facts.js";

/**
 * `dim acp` (verified on 0.5.27) serves ACP v1 with session new/load/prompt/cancel/list/fork/set_mode/set_model/
 * set_config_option/close, reverse fs/terminal/elicitation, and usage notifications that carry `costUSD`. The
 * documented `session/new` takes `cwd` and `mcpServers`, so the system prompt opens the first prompt.
 */
export const dimAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: DIM_ID,
  command: DIM_COMMAND,
  args: DIM_ACP_ARGS,
  env: [...BASE_ENV, ...DIM_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: session/new may gain _meta fields in newer releases",
    "the ACP server is built on @agentclientprotocol/sdk 0.21.1; unstable surfaces may move"
  ]
};
