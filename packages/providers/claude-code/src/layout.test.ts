import { describe, expect, it } from "vite-plus/test";

import { claudeCodeUsageSourceId, claudeCodeUsageTarget, looksLikeClaudeCodeSession } from "./layout.js";

describe("claude-code usage sources", () => {
  it("identifies a source by its path below the project directory, which a moved working directory renames", () => {
    expect(claudeCodeUsageSourceId("/h/projects/proj/s-1.jsonl", "/h/projects")).toBe("s-1.jsonl");
    expect(claudeCodeUsageSourceId("/h/projects/proj/s-1/subagents/agent-a.jsonl", "/h/projects")).toBe(
      "s-1/subagents/agent-a.jsonl"
    );
  });

  it("knows a walk file's session and lane, and no session for a target that is not one of them", () => {
    expect(claudeCodeUsageTarget("/h/projects/proj/s-1.jsonl")).toEqual({ sessionId: "s-1" });
    expect(claudeCodeUsageTarget("/h/projects/proj/s-1/subagents/agent-a.jsonl")).toEqual({
      sessionId: "s-1",
      agentLaneId: "a"
    });
    expect(claudeCodeUsageTarget("/h/projects/proj/s-1/subagents/agent-a.meta.json")).toEqual({ sessionId: "unknown" });
  });
});

describe("claude-code session detection", () => {
  it("recognizes relocated records and defers unsupported generations to the loader", () => {
    for (const record of [
      { type: "user", sessionId: "s", uuid: "u", message: { role: "user", content: "hello" } },
      { type: "assistant", sessionId: "s", message: { content: [] } },
      { type: "user", sessionId: "s", uuid: "u", formatVersion: 2 },
      { type: "user", sessionId: "s", uuid: "u", version: 2 },
      { type: "user", sessionId: "s", uuid: "u", version: "2.1" }
    ]) {
      expect(looksLikeClaudeCodeSession("/logs/moved.jsonl", JSON.stringify(record))).toBe(true);
    }
    expect(looksLikeClaudeCodeSession("/synthetic/.claude/projects/p/s.jsonl", undefined)).toBe(true);
  });

  it("does not assemble a session identity from separate records or nested message text", () => {
    const records = [
      { sessionId: "s", projectHash: "project", kind: "main" },
      { type: "user", id: "u", content: "hello" }
    ];
    expect(
      looksLikeClaudeCodeSession("/logs/chat.jsonl", records.map((record) => JSON.stringify(record)).join("\n"))
    ).toBe(false);
    expect(
      looksLikeClaudeCodeSession(
        "/logs/chat.json",
        JSON.stringify({ ...records[0], messages: records.slice(1) }, null, 2)
      )
    ).toBe(false);
    expect(looksLikeClaudeCodeSession("/logs/chat.jsonl", JSON.stringify({ text: records }))).toBe(false);
    expect(
      looksLikeClaudeCodeSession("/logs/chat.jsonl", JSON.stringify({ type: "user", sessionId: "s", uuid: "u" }))
    ).toBe(false);
    expect(looksLikeClaudeCodeSession("/logs/chat.jsonl", '{"type":"user","sessionId":"s","uuid":')).toBe(false);
  });
});
