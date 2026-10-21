import type { SessionAdapter } from "../../spi.js";
import { claudeCodeSessionAdapter } from "./claude-code.js";
import { codexSessionAdapter } from "./codex.js";

/** The built-in session adapters. The shell merges `providers` descriptors with a `sessions` service into these defaults. */
export const builtinSessionAdapters: {
  readonly "claude-code": SessionAdapter;
  readonly codex: SessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter
};
