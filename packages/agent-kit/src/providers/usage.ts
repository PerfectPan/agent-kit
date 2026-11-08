import { codexUsageDecoder } from "@rivus/agent-kit-provider-codex/usage";
import { claudeCodeUsageDecoder } from "@rivus/agent-kit-provider-claude-code/usage";
import { dshUsageDecoder } from "@rivus/agent-kit-provider-dsh/usage";
import { grokUsageDecoder } from "@rivus/agent-kit-provider-grok/usage";
import { opencodeUsageDecoder } from "@rivus/agent-kit-provider-opencode/usage";
import { geminiCliUsageDecoder } from "@rivus/agent-kit-provider-gemini-cli/usage";
import { piUsageDecoder } from "@rivus/agent-kit-provider-pi/usage";
import { zcodeUsageDecoder } from "@rivus/agent-kit-provider-zcode/usage";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

const builtinUsageDecoders: {
  readonly codex: typeof codexUsageDecoder;
  readonly "claude-code": typeof claudeCodeUsageDecoder;
  readonly dsh: typeof dshUsageDecoder;
  readonly grok: typeof grokUsageDecoder;
  readonly opencode: typeof opencodeUsageDecoder;
  readonly "gemini-cli": typeof geminiCliUsageDecoder;
  readonly pi: typeof piUsageDecoder;
  readonly zcode: typeof zcodeUsageDecoder;
} = {
  "claude-code": claudeCodeUsageDecoder,
  codex: codexUsageDecoder,
  dsh: dshUsageDecoder,
  "gemini-cli": geminiCliUsageDecoder,
  grok: grokUsageDecoder,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder,
  zcode: zcodeUsageDecoder
};

export const usageTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"usage">> =>
  mergeService("usage", builtinUsageDecoders, providers);
