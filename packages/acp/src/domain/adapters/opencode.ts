import type { AcpProfile } from "../acp-session/index.js";
import { BASE_ENV } from "./base-env.js";

/**
 * `opencode acp`. Version 1.18.30 has no system prompt channel. opencode reaches many model providers, so every
 * `*_API_KEY` variable passes, with opencode's own and the common provider settings.
 */
export const opencodeAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "opencode",
  command: "opencode",
  args: ["acp"],
  env: [...BASE_ENV, "OPENCODE_*", "*_API_KEY", "ANTHROPIC_*", "OPENAI_*", "AWS_*", "AZURE_*", "GOOGLE_*", "VERTEX_*"],
  systemPrompt: { in: "first-block" },
  warnings: []
};
