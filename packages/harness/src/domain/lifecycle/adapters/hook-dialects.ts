import { type BuiltinCodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialect } from "../spi/hook-dialect.js";

/** The agents with a built-in dialect; catalog knows more agents than have hooks. */
type HookAgentId = Extract<BuiltinCodingAgentId, never>;

export const builtinHookDialects: Readonly<Record<HookAgentId, HookDialect>> = {};
