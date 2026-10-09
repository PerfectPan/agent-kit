import { describe, expect, it } from "vite-plus/test";

import { AgentKitError, isAgentKitError } from "./agent-kit-error.js";

describe("AgentKitError", () => {
  it("carries a code, a message and a cause", () => {
    const cause = new Error("disk");
    const error = new AgentKitError("session-not-found", "missing", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "AgentKitError",
      code: "session-not-found",
      message: "missing",
      cause
    });
    expect("cause" in new AgentKitError("x", "no cause")).toBe(false);
  });

  it("is recognized across duplicate copies of the kit by its registered brand", () => {
    // What another copy of the class produces: a different constructor, the same registered symbol.
    class OtherCopy extends Error {
      readonly code = "x";
      constructor() {
        super("other");
        Object.defineProperty(this, Symbol.for("@rivus/agent-kit/AgentKitError"), { value: true });
      }
    }
    const foreign = new OtherCopy();
    expect(isAgentKitError(foreign)).toBe(true);
    expect(foreign instanceof AgentKitError).toBe(true);
    expect(isAgentKitError(new Error("plain"))).toBe(false);
    expect(new Error("plain") instanceof AgentKitError).toBe(false);
    expect(isAgentKitError({ code: "x" })).toBe(false);
  });
});
