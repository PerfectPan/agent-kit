import { describe, expect, it } from "vite-plus/test";
import { readHookEvent } from "@rivus/agent-kit-harness";
import { opencodeHookDialect } from "../src/hooks.js";
const testHooks = { opencode: opencodeHookDialect };

describe("opencode hooks", () => {
  it("S111: reads opencode's currentSessionId only after every native session path", () => {
    const remembered = readHookEvent(
      "opencode",
      {
        type: "file.edited",
        properties: { file: "/u/me/work/a.ts" },
        directory: "/u/me/work",
        currentSessionId: "A"
      },
      {},
      { providers: { hooks: testHooks } }
    );
    expect(remembered.sessionId).toBe("A");
    const named = readHookEvent(
      "opencode",
      {
        type: "message.updated",
        properties: { info: { id: "msg_1", sessionID: "B" } },
        directory: "/u/me/work",
        currentSessionId: "A"
      },
      {},
      { providers: { hooks: testHooks } }
    );
    expect(named.sessionId).toBe("B");
  });

  it("S113: reads opencode's info.id as the session id only where info is a Session", () => {
    const sessionOf = (payload: object) =>
      readHookEvent("opencode", payload, {}, { providers: { hooks: testHooks } }).sessionId;
    expect(sessionOf({ type: "message.updated", properties: { info: { id: "msg_1" } } })).toBeUndefined();
    expect(sessionOf({ type: "pty.created", properties: { info: { id: "pty_1" } } })).toBeUndefined();
    expect(sessionOf({ type: "pty.updated", properties: { info: { id: "pty_1" } }, currentSessionId: "A" })).toBe("A");
    for (const type of ["session.created", "session.updated", "session.deleted"]) {
      expect(sessionOf({ type, properties: { info: { id: "ses_1" } } })).toBe("ses_1");
      expect(sessionOf({ type, properties: { info: { id: "ses_1" } }, currentSessionId: "A" })).toBe("ses_1");
    }
  });
});
