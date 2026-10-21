import type { BuiltinCodingAgentId } from "./identity.js";
import type { Provider } from "./types.js";

/** Missing built-in capabilities; every other service has an implementation. */
export const unsupported: Readonly<
  Record<BuiltinCodingAgentId, Partial<Record<Exclude<keyof Provider, "id">, string>>>
> = {
  "claude-code": {},
  codex: {},
  grok: {},
  cursor: {
    sessions: "Session storage has no supported reader.",
    usage: "Usage storage has no supported decoder.",
    acp: "No supported ACP transport."
  },
  "gemini-cli": { sessions: "Session storage has no supported reader." },
  opencode: { sessions: "Session storage has no supported reader." },
  pi: { sessions: "Session storage has no supported reader.", acp: "No supported ACP transport." }
};
