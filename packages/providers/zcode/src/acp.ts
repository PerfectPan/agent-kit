import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { ZCODE_ACP_COMMAND, ZCODE_ACP_ENV, ZCODE_ID } from "./facts.js";

/**
 * ZCode has no ACP server of its own; `zcode-acp-server` (npm `zcode-acp-server`, william0wang/zcode-acp) bridges
 * ACP over stdio to `zcode app-server --stdio`. Checked against `zcode-acp-server` 0.89.0: invoking the
 * `zcode-acp-server` bin starts the stdio ACP server directly with no subcommand, and `session/new` reads no system
 * prompt from `_meta`, so the system prompt opens the first prompt.
 */
export const zcodeAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: ZCODE_ID,
  command: ZCODE_ACP_COMMAND,
  args: [],
  env: [...BASE_ENV, ...ZCODE_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: the community adapter (william0wang/zcode-acp, npm zcode-acp-server) moves fast; session capabilities and env vars may drift",
    "zcode-acp-server defaults ZCODE_ACP_MODE to yolo (unrestricted) unless configured otherwise",
    "unverified: session/new may gain _meta fields in newer releases"
  ]
};
