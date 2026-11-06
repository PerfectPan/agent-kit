import type { BuiltinCodingAgentId } from "./identity.js";
import type { Provider } from "./types.js";

/** Missing built-in capabilities; every other service has an implementation. */
export const unsupported: Readonly<
  Record<BuiltinCodingAgentId, Partial<Record<Exclude<keyof Provider, "id">, string>>>
> = {
  "claude-code": {},
  codex: {},
  dsh: {
    discovery: "No supported installation probe.",
    hooks: "No supported hook dialect.",
    install: "No supported installation adapter.",
    usage: "Usage storage has no supported decoder.",
    acp: "No supported ACP transport."
  },
  grok: {},
  cursor: {
    sessions: "Session storage has no supported reader.",
    usage: "Usage storage has no supported decoder.",
    acp: "No supported ACP transport."
  },
  "gemini-cli": {},
  opencode: {},
  pi: { acp: "No supported ACP transport." }
};
