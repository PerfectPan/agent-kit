import { type BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialect } from "../spi/hook-dialect.js";
import { codexHookDialect } from "./codex.js";

/** The agents with a built-in dialect; catalog knows more agents than have hooks. */
type HookAgentId = Extract<BuiltinCodingAgentId, "codex">;

export const builtinHookDialects: Readonly<Record<HookAgentId, HookDialect>> = {
  codex: codexHookDialect
};
