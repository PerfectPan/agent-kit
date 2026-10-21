import { opencodeUsageDecoder } from "@rivus/agent-kit-provider-opencode/usage";
import { geminiCliUsageDecoder } from "@rivus/agent-kit-provider-gemini-cli/usage";
import { builtinUsageDecoders as contextBuiltins } from "@rivus/agent-kit-sessions/public";
import { piUsageDecoder } from "@rivus/agent-kit-provider-pi/usage";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

const builtinUsageDecoders: typeof contextBuiltins & {
  readonly opencode: typeof opencodeUsageDecoder;
  readonly "gemini-cli": typeof geminiCliUsageDecoder;
  readonly pi: typeof piUsageDecoder;
} = {
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  "gemini-cli": geminiCliUsageDecoder,
  grok: contextBuiltins.grok,
  opencode: opencodeUsageDecoder,
  pi: piUsageDecoder
};

export const usageTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"usage">> =>
  mergeService("usage", builtinUsageDecoders, providers);
