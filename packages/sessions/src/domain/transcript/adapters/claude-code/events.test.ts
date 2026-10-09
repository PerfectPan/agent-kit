import { describe, expect, it } from "vitest";

import { translateClaudeCodeRecords } from "./events.js";

const session = (result: ReturnType<typeof translateClaudeCodeRecords>) => {
  if (!result.ok) {
    throw new Error(`unexpected generation: ${JSON.stringify(result.error)}`);
  }
  return result.value.session;
};

const stamped = (value: unknown) => [
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
      stamped({
        type: "user",
        uuid: "m-1",
        sessionId: "from-record",
        message: { role: "user", content: "hi" }
      }),
      { path: "/r/s-1.jsonl" }
    );
    expect(session(named).id).toBe("from-record");
  });

  it("treats a record without a known envelope as an unknown format generation", () => {
    for (const value of [
      { sessionId: "s" },
      { type: 2 },
      { type: "user", version: 2 },
      { type: "user", version: "2.1" },
      { type: "user", formatVersion: null },
      { type: "user", formatVersion: undefined },
      "user",
      ["user"]
    ]) {
      expect(translateClaudeCodeRecords(stamped(value))).toEqual({
        ok: false,
        error: {
          _tag: "UnknownFormatGeneration",
          agent: "claude-code",
          file: "session.jsonl",
          line: 1
        }
      });
    }
  });

  it("keeps a record whose version is a value JSON cannot carry, like the hand-written readers did", () => {
    for (const version of [new Date(), new Map(), 2n, () => "2.0.0"]) {
      expect(translateClaudeCodeRecords(stamped({ type: "user", uuid: "m-1", version })).ok).toBe(true);
    }
  });

  it("reads a record leniently: a field of an unexpected type counts as absent", () => {
    const result = translateClaudeCodeRecords(
      stamped({
        type: "user",
        uuid: 7,
        sessionId: 9,
        version: true,
        message: "hello",
        isMeta: "yes"
      }),
      { path: "/r/s-1.jsonl" }
    );
    if (!result.ok) {
      throw new Error("unexpected generation");
    }
    expect(result.value.session).toEqual({ id: "s-1", startedAt: 1, endedAt: 1 });
    expect(result.value.agentVersion).toBeUndefined();
    expect(result.value.events).toEqual([
      expect.objectContaining({ id: "session.jsonl:1", kind: "user", payload: {} })
    ]);
  });

  it("keeps a rejected content block in its place as an unknown event", () => {
    const result = translateClaudeCodeRecords(
      stamped({
        type: "assistant",
        uuid: "a",
        message: { content: ["nope", { type: 5 }, { type: "text", text: "ok" }] }
      })
    );
    if (!result.ok) {
      throw new Error("unexpected generation");
    }
    expect(result.value.events.map((event) => [event.id, event.kind, event.payload])).toEqual([
      ["a", "unknown", { type: "block" }],
      ["a:1", "unknown", { type: "block" }],
      ["a:2", "assistant", { text: "ok" }]
    ]);
  });
});
