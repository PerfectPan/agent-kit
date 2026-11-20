import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { CURSOR_ACP_ARGS, CURSOR_ACP_ENV, CURSOR_AGENT_COMMAND, CURSOR_ID } from "./facts.js";

/**
 * `cursor-agent acp`: Cursor CLI's Agent Client Protocol stdio JSON-RPC server (documented as `agent acp`, also
 * installed under the unambiguous `cursor-agent` command name). Uses `cursor-agent` to avoid colliding with
 * unrelated `agent` binaries on `PATH`. Authentication accepts `CURSOR_API_KEY`, `CURSOR_AUTH_TOKEN`, or an
 * existing `cursor-agent login` session (`methodId: "cursor_login"`).
 */
export const cursorAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: CURSOR_ID,
  command: CURSOR_AGENT_COMMAND,
  args: CURSOR_ACP_ARGS,
  env: [...BASE_ENV, ...CURSOR_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: Cursor CLI documents 'agent acp' (also installed as 'cursor-agent'); this profile invokes 'cursor-agent' to avoid colliding with unrelated 'agent' binaries on PATH",
    "unverified: whether session/new reads a system prompt from _meta; the profile opens the first prompt with it",
    "unverified: Cursor CLI ACP authentication uses methodId 'cursor_login' or CURSOR_API_KEY / CURSOR_AUTH_TOKEN; not live-verified against a local cursor-agent binary"
  ]
};
