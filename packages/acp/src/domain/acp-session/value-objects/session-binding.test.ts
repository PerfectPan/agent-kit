import { describe, expect, it } from "vite-plus/test";

import { SessionBinding } from "./session-binding.js";

const binding = SessionBinding.restore({ sessionKey: "task", agent: "claude-code", sessionId: "s1", cwd: "/work" });

describe("SessionBinding", () => {
  it("hands a binding to the agent that made it, and to no other", () => {
    expect(binding.forAgent("claude-code")).toBe(binding);
    expect(binding.forAgent("codex")).toBeUndefined();
  });

  it("retains the accepted string values without adding validation", () => {
    const snapshot = { sessionKey: "", agent: "", sessionId: "", cwd: "" };
    const value = SessionBinding.restore(snapshot);
    expect(value.toSnapshot()).toEqual(snapshot);
    expect(value.forAgent("")).toBe(value);
  });

  it("owns its snapshot without freezing the caller's data", () => {
    const snapshot = { sessionKey: "task", agent: "claude-code", sessionId: "s1", cwd: "/work" };
    const value = SessionBinding.restore(snapshot);
    snapshot.sessionId = "changed";
    expect(value.sessionId).toBe("s1");
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
    const returned = value.toSnapshot();
    expect(returned).toEqual({ sessionKey: "task", agent: "claude-code", sessionId: "s1", cwd: "/work" });
    expect(Object.getPrototypeOf(returned)).toBe(Object.prototype);
    expect(value.toSnapshot()).not.toBe(returned);
    Object.assign(returned, { sessionId: "external" });
    expect(value.sessionId).toBe("s1");
  });
});
