import { cursorProbe } from "@rivus/agent-kit-provider-cursor/discovery";
import { builtinProbeRecipes as contextBuiltins } from "@rivus/agent-kit-discovery/public";
import { piProbe } from "@rivus/agent-kit-provider-pi/discovery";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinProbeRecipes: typeof contextBuiltins & {
  readonly cursor: typeof cursorProbe;
  readonly pi: typeof piProbe;
} = {
  opencode: contextBuiltins.opencode,
  "claude-code": contextBuiltins["claude-code"],
  codex: contextBuiltins.codex,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": contextBuiltins["gemini-cli"],
  grok: contextBuiltins.grok
};

export const discoveryTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"discovery">> =>
  mergeService("discovery", builtinProbeRecipes, providers);
