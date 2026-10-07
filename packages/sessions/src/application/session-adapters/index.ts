import type { SessionAdapter } from "../ports.js";
import { claudeCodeSessionAdapter } from "./claude-code.js";

/** The session adapters of the built-in agents. Use cases default to it; pass `adapters` to replace or extend it. */
export const builtinSessionAdapters: { readonly "claude-code": SessionAdapter } = {
  "claude-code": claudeCodeSessionAdapter
};
