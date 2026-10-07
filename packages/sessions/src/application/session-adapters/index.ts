import type { SessionAdapter } from "../ports.js";
import { claudeCodeSessionAdapter } from "./claude-code.js";
import { codexSessionAdapter } from "./codex.js";

/** The session adapters of the built-in agents. Use cases default to it; pass `adapters` to replace or extend it. */
export const builtinSessionAdapters: { readonly "claude-code": SessionAdapter; readonly codex: SessionAdapter } = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter
};
