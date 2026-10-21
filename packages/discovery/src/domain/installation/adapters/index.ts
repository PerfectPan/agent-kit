import type { BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { ProbeRecipe } from "../index.js";
import { claudeCodeProbe } from "./claude-code.js";
import { codexProbe } from "./codex.js";

/**
 * The probe recipes of the built-in agents, in report order. The shell uses these defaults and merges
 * `providers` descriptors with a `discovery` service to replace or extend them.
 */
export const builtinProbeRecipes: Readonly<
  Record<Exclude<BuiltinCodingAgentId, "pi" | "cursor" | "gemini-cli" | "opencode" | "grok">, ProbeRecipe>
> = {
  "claude-code": claudeCodeProbe,
  codex: codexProbe
};
