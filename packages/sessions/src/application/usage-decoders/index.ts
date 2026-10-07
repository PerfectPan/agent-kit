import type { UsageDecoder } from "../usage-ports.js";
import { claudeCodeUsageDecoder } from "./claude-code.js";
import { codexUsageDecoder } from "./codex.js";
import { geminiCliUsageDecoder } from "./gemini-cli.js";
import { grokUsageDecoder } from "./grok.js";
import { opencodeUsageDecoder } from "./opencode.js";
import { piUsageDecoder } from "./pi.js";

/** The usage decoders of the built-in agents. Use cases default to it; pass `decoders` to replace or extend it. */
export const builtinUsageDecoders: {
  readonly "claude-code": UsageDecoder;
  readonly codex: UsageDecoder;
  readonly "gemini-cli": UsageDecoder;
  readonly grok: UsageDecoder;
  readonly opencode: UsageDecoder;
  readonly pi: UsageDecoder;
} = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder
};
