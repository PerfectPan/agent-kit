import { describe, expect, it } from "vitest";

import { claudeCodeUsageSourceId, claudeCodeUsageTarget } from "./layout.js";

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
