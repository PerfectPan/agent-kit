import { type BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialect } from "../spi/hook-dialect.js";
import { claudeCodeHookDialect } from "./claude-code.js";
import { codexHookDialect } from "./codex.js";
import { grokHookDialect } from "./grok.js";

/** The agents with a built-in dialect; catalog knows more agents than have hooks. */
type HookAgentId = Extract<BuiltinCodingAgentId, "claude-code" | "codex" | "grok">;

export const builtinHookDialects: Readonly<Record<HookAgentId, HookDialect>> = {
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  grok: grokHookDialect
};
