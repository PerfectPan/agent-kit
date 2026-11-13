import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { QODER_ACP_ARGS, QODER_ACP_ENV, QODER_COMMAND, QODER_ID } from "./facts.js";

/**
 * `qodercli --acp` (verified on 1.1.88: the initialize response names `qoder-cli` and lists loadSession, session
 * list/resume/close/delete/fork, image and embeddedContext, MCP http/sse; auth method `qodercli-login`). The
 * documented `session/new` takes `cwd`/`mcpServers`/`additionalDirectories`, so the system prompt opens the first
 * prompt.
 */
export const qoderAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: QODER_ID,
  command: QODER_COMMAND,
  args: QODER_ACP_ARGS,
  env: [...BASE_ENV, ...QODER_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: the ACP flag is --acp; newer releases may rename it, as Gemini CLI's --experimental-acp shows",
    "unverified: session/new may gain _meta fields in newer releases"
  ]
};
