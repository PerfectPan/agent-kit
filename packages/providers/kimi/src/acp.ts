import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { KIMI_ACP_ARGS, KIMI_ACP_ENV, KIMI_ID } from "./facts.js";

/**
 * `kimi acp` (https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html) speaks ACP v1 with the full
 * core and session surface, including session/load, session/list and set_config_option. Its `session/new` documents
 * no system-prompt `_meta` key, so the system prompt opens the first prompt.
 */
export const kimiAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: KIMI_ID,
  command: "kimi",
  args: KIMI_ACP_ARGS,
  env: [...BASE_ENV, ...KIMI_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: session/new may gain _meta fields, such as a system prompt, in newer releases",
    "Kimi reads model credentials from config.toml, not the environment; an unconfigured install reports auth_required",
    "a config.toml provider whose api_key_env names a variable outside KIMI_* is not forwarded, because the profile's environment is a static allowlist; name the variable KIMI_* or store the key in config.toml"
  ]
};
