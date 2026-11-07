import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { DSH_ACP_ARGS, DSH_ACP_ENV, DSH_COMMAND, DSH_ID } from "./facts.js";

// The READMEs of `@deepseek-ai/dsh` 0.2.1-rc.3 and its `dsh-acp` package: `dsh --profile acp` serves ACP v1 over stdio,
// `authenticate` succeeds without credentials, and the profile adds no private method, capability or `_meta`.
export const dshAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: DSH_ID,
  command: DSH_COMMAND,
  args: DSH_ACP_ARGS,
  env: [...BASE_ENV, ...DSH_ACP_ENV],
  // Without a `_meta` channel, the system prompt goes in front of the first prompt block.
  systemPrompt: { in: "first-block" },
  warnings: []
};
