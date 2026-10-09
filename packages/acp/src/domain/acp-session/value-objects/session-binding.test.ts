import { describe, expect, it } from "vite-plus/test";

import { bindingFor, type SessionBinding } from "./session-binding.js";

const binding: SessionBinding = { sessionKey: "task", agent: "claude-code", sessionId: "s1", cwd: "/work" };

describe("bindingFor", () => {
  it("hands a binding to the agent that made it, and to no other", () => {
    expect(bindingFor("claude-code", binding)).toBe(binding);
    expect(bindingFor("codex", binding)).toBeUndefined();
    expect(bindingFor("claude-code", undefined)).toBeUndefined();
  });
});
