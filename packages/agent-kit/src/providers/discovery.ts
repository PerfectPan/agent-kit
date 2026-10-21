import { codexProbe } from "@rivus/agent-kit-provider-codex/discovery";
import { claudeCodeProbe } from "@rivus/agent-kit-provider-claude-code/discovery";
import { grokProbe } from "@rivus/agent-kit-provider-grok/discovery";
import { opencodeProbe } from "@rivus/agent-kit-provider-opencode/discovery";
import { geminiCliProbe } from "@rivus/agent-kit-provider-gemini-cli/discovery";
import { cursorProbe } from "@rivus/agent-kit-provider-cursor/discovery";
import { builtinProbeRecipes as contextBuiltins } from "@rivus/agent-kit-discovery/public";
import { piProbe } from "@rivus/agent-kit-provider-pi/discovery";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinProbeRecipes: typeof contextBuiltins & {
  readonly codex: typeof codexProbe;
  readonly "claude-code": typeof claudeCodeProbe;
  readonly grok: typeof grokProbe;
  readonly opencode: typeof opencodeProbe;
  readonly "gemini-cli": typeof geminiCliProbe;
  readonly cursor: typeof cursorProbe;
  readonly pi: typeof piProbe;
} = {
  opencode: opencodeProbe,
  "claude-code": claudeCodeProbe,
  codex: codexProbe,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": geminiCliProbe,
  grok: grokProbe
};

export const discoveryTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"discovery">> =>
  mergeService("discovery", builtinProbeRecipes, providers);
