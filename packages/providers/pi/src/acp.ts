import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { PI_ACP_COMMAND, PI_ACP_ENV, PI_ID } from "./facts.js";

/**
 * Pi has no ACP server of its own; `pi-acp` (npm `pi-acp`, svkozak/pi-acp) bridges ACP to `pi --mode rpc`. Version
 * 0.0.34 reads no `_meta` on `session/new`, so the system prompt opens the first prompt. It never permission-gates
 * tool calls, keeps one live Pi session per connection (`sessions: "single"`, so the kit refuses a new or loaded
 * session while another session of the connection runs a turn), and every `session/new` runs a network `npm view`
 * to build its update notice.
 */
export const piAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: PI_ID,
  command: PI_ACP_COMMAND,
  args: [],
  env: [...BASE_ENV, ...PI_ACP_ENV],
  systemPrompt: { in: "first-block" },
  sessions: "single",
  warnings: [
    "unverified: the community adapter (svkozak/pi-acp) moves fast; session capabilities may drift",
    "Pi executes tool calls without permission prompts, so sessions run with the caller's rights",
    "the adapter keeps one live session per connection and runs a network npm view on session/new",
    "verified against pi-acp 0.0.34 with pi 0.87.1; pi 1.5.2 stalls the adapter, because its rpc mode answers unknown commands without an id"
  ]
};
