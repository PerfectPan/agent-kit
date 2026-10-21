import type { UsageDecoder } from "../../spi.js";
import { claudeCodeUsageDecoder } from "./claude-code.js";
import { codexUsageDecoder } from "./codex.js";
import { grokUsageDecoder } from "./grok.js";

/** The built-in usage decoders. The shell merges `providers` descriptors with a `usage` service into these defaults. */
export const builtinUsageDecoders: {
  readonly "claude-code": UsageDecoder;
  readonly codex: UsageDecoder;
  readonly grok: UsageDecoder;
} = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  grok: grokUsageDecoder
};
