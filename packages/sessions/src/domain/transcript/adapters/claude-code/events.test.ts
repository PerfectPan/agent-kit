import { describe, expect, it } from "vitest";

import { translateClaudeCodeRecords } from "./events.js";

const session = (result: ReturnType<typeof translateClaudeCodeRecords>) => {
  if (!result.ok) {
    throw new Error(`unexpected generation: ${JSON.stringify(result.error)}`);
  }
  return result.value.session;
};

const stamped = (value: Record<string, unknown>) => [
  { record: { value, file: "session.jsonl", offset: 0, length: 0, line: 1 }, ts: 1 }
];

describe("translateClaudeCodeRecords", () => {
  it("names a session the records say nothing about after its file, else unknown", () => {
    expect(session(translateClaudeCodeRecords([], {})).id).toBe("unknown");
    expect(session(translateClaudeCodeRecords([], { path: "/r/projects/proj/s-1.jsonl" })).id).toBe("s-1");
    expect(session(translateClaudeCodeRecords([], { path: "/r/projects/proj/.jsonl" })).id).toBe("unknown");
  });

  it("lets the session id option and the records win over the file name", () => {
    expect(session(translateClaudeCodeRecords([], { sessionId: "from-caller", path: "/r/s-1.jsonl" })).id).toBe(
      "from-caller"
    );
    const named = translateClaudeCodeRecords(
      stamped({ type: "user", uuid: "m-1", sessionId: "from-record", message: { role: "user", content: "hi" } }),
      { path: "/r/s-1.jsonl" }
    );
    expect(session(named).id).toBe("from-record");
  });
});
