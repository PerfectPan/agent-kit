import type { BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { ProbeRecipe } from "../installation/index.js";
import { claudeCodeProbe } from "./claude-code.js";
import { codexProbe } from "./codex.js";
import { cursorProbe } from "./cursor.js";
import { geminiCliProbe } from "./gemini-cli.js";
import { grokProbe } from "./grok.js";
import { opencodeProbe } from "./opencode.js";
import { piProbe } from "./pi.js";

/**
 * The probe recipes of the built-in agents, in report order. `detectAgents` defaults to it; pass `recipes` to
 * replace or extend it.
 */
export const builtinProbeRecipes: Readonly<Record<BuiltinCodingAgentId, ProbeRecipe>> = {
  opencode: opencodeProbe,
  "claude-code": claudeCodeProbe,
  codex: codexProbe,
  cursor: cursorProbe,
  pi: piProbe,
  "gemini-cli": geminiCliProbe,
  grok: grokProbe
};
