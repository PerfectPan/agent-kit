import type { HomeRule } from "@rivus/agent-kit-catalog/spi";

/** @public */
export const PI_ID = "pi";
/** @public */
export const PI_DISPLAY_NAME = "Pi";
/** @public */
export const HOME_DIR = ".pi";
/** @public */
export const HOME_ENV = "PI_CODING_AGENT_DIR";
// The override names the agent directory itself, rather than its parent.
/** @public */
export const PI_HOME: HomeRule = { envVar: HOME_ENV, expandsTilde: true, defaultPath: [HOME_DIR, "agent"] };
/** @public */
export const PI_SESSIONS_DIR = "sessions";
/** @public */
export const PI_EXTENSIONS_DIR = "extensions";
/** @public */
export const PI_SETTINGS_FILE = "settings.json";
/** @public */
export const PI_EXTENSIONS_POINTER = "/extensions";
/** @public */
export const PI_EXTENSION_SUFFIX = ".ts";
/** @public */
export const PI_EXTENSION_SUFFIXES: readonly string[] = [".js", PI_EXTENSION_SUFFIX];
/** @public */
export const PI_SESSION_SUFFIX = ".jsonl";
/** @public */
export const PI_SESSION_SUFFIX_PATTERN: RegExp = /\.jsonl$/;

// Pi ships no ACP server; the community adapter (npm `pi-acp`, svkozak/pi-acp) drives `pi --mode rpc`.
/** @public */
export const PI_ACP_COMMAND = "pi-acp";
/** @public */
export const PI_ACP_ENV: readonly string[] = [
  "PI_*",
  // Pi reads provider keys from the environment (or `~/.pi/agent/auth.json` and `models.json`); these globs cover
  // the providers its documentation lists. `GEMINI_*` and `GOOGLE_*` both appear across Pi versions.
  "ANTHROPIC_*",
  "OPENAI_*",
  "GEMINI_*",
  "GOOGLE_*",
  "DEEPSEEK_*",
  "XAI_*",
  "OPENROUTER_*",
  "GROQ_*",
  "MISTRAL_*",
  "ZAI_*",
  "CEREBRAS_*",
  "AZURE_*",
  "GOOGLE_APPLICATION_CREDENTIALS",
  // The remaining single-variable providers of pi 0.87.1's `env-api-keys.ts`, by their `envMap` names.
  "ANT_LING_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY",
  "QWEN_TOKEN_PLAN_CN_API_KEY",
  "NVIDIA_API_KEY",
  "MOONSHOT_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "RADIUS_API_KEY",
  "AI_GATEWAY_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "TOGETHER_API_KEY",
  "BASETEN_API_KEY",
  "OPENCODE_API_KEY",
  "KIMI_API_KEY",
  "META_API_KEY",
  "CLOUDFLARE_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  // The AWS credential chain of the Bedrock provider: the SDK's credential sources, the region pi reads, and the
  // web-identity role pair.
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_DEFAULT_REGION"
];

/** @public */
export const agentMarkers: readonly string[] = [PI_ID, HOME_DIR, HOME_ENV];
