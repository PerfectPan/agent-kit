import { type BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialect } from "../spi/hook-dialect.js";
import { claudeCodeHookDialect } from "./claude-code.js";
import { codexHookDialect } from "./codex.js";
import { geminiCliHookDialect } from "./gemini-cli.js";
import { grokHookDialect } from "./grok.js";
import { opencodeHookDialect } from "./opencode.js";

/** The agents with a built-in dialect; catalog knows more agents than have hooks. */
type HookAgentId = Extract<BuiltinCodingAgentId, "claude-code" | "codex" | "gemini-cli" | "grok" | "opencode">;

export const builtinHookDialects: Readonly<Record<HookAgentId, HookDialect>> = {
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect
};
