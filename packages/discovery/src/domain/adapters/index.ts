import type { BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { ProbeRecipe } from "../installation/index.js";
import { aiderProbe } from "./aider.js";
import { ampProbe } from "./amp.js";
import { antigravityProbe } from "./antigravity.js";
import { claudeCodeProbe } from "./claude-code.js";
import { clineProbe } from "./cline.js";
import { codebuddyProbe } from "./codebuddy.js";
import { codexDesktopProbe } from "./codex-desktop.js";
import { codexProbe } from "./codex.js";
import { commandCodeProbe } from "./command-code.js";
import { cursorProbe } from "./cursor.js";
import { geminiCliProbe } from "./gemini-cli.js";
import { githubCopilotProbe } from "./github-copilot.js";
import { grokProbe } from "./grok.js";
import { hermesProbe } from "./hermes.js";
import { kimiCodeCliProbe } from "./kimi-code-cli.js";
import { kiroCliProbe } from "./kiro-cli.js";
import { neovateProbe } from "./neovate.js";
import { openclawProbe } from "./openclaw.js";
import { opencodeProbe } from "./opencode.js";
import { openhandsProbe } from "./openhands.js";
import { piProbe } from "./pi.js";
import { qoderProbe } from "./qoder.js";
import { rooCodeProbe } from "./roo-code.js";
import { traeProbe } from "./trae.js";
import { vscodeCopilotProbe } from "./vscode-copilot.js";
import { windsurfProbe } from "./windsurf.js";
import { zencoderProbe } from "./zencoder.js";

/**
 * The probe recipes of the built-in agents, in report order. `detectAgents` defaults to it; pass `recipes` to
 * replace or extend it.
 */
export const builtinProbeRecipes: Readonly<Record<BuiltinCodingAgentId, ProbeRecipe>> = {
  opencode: opencodeProbe,
  openhands: openhandsProbe,
  "claude-code": claudeCodeProbe,
  cline: clineProbe,
  codebuddy: codebuddyProbe,
  codex: codexProbe,
  "command-code": commandCodeProbe,
  "kiro-cli": kiroCliProbe,
  cursor: cursorProbe,
  antigravity: antigravityProbe,
  "roo-code": rooCodeProbe,
  "github-copilot": githubCopilotProbe,
  amp: ampProbe,
  openclaw: openclawProbe,
  neovate: neovateProbe,
  pi: piProbe,
  qoder: qoderProbe,
  zencoder: zencoderProbe,
  "kimi-code-cli": kimiCodeCliProbe,
  "gemini-cli": geminiCliProbe,
  windsurf: windsurfProbe,
  "vscode-copilot": vscodeCopilotProbe,
  "codex-desktop": codexDesktopProbe,
  aider: aiderProbe,
  hermes: hermesProbe,
  trae: traeProbe,
  grok: grokProbe
};
