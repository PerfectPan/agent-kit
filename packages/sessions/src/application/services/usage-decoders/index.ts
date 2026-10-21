import type { UsageDecoder } from "../../spi.js";
import { claudeCodeUsageDecoder } from "./claude-code.js";
import { codexUsageDecoder } from "./codex.js";
import { geminiCliUsageDecoder } from "./gemini-cli.js";
import { grokUsageDecoder } from "./grok.js";
import { opencodeUsageDecoder } from "./opencode.js";

/** The built-in usage decoders. The shell merges `providers` descriptors with a `usage` service into these defaults. */
export const builtinUsageDecoders: {
  readonly "claude-code": UsageDecoder;
  readonly codex: UsageDecoder;
  readonly "gemini-cli": UsageDecoder;
  readonly grok: UsageDecoder;
  readonly opencode: UsageDecoder;
} = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder
};
