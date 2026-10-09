import { describe, expect, it } from "vitest";

import { previewClaudeCodeRecords } from "./preview.js";

describe("previewClaudeCodeRecords", () => {
  it("reads a record leniently: a field of an unexpected type counts as absent", () => {
    expect(
      previewClaudeCodeRecords([
        { type: "user", sessionId: 9, cwd: 10, customTitle: 11, timestamp: "nope", message: 3 },
        {
          type: "user",
          sessionId: "s-2",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/work/app",
          isMeta: "yes",
          message: { content: "Real work" }
        }
      ])
    ).toEqual({
      sessionId: "s-2",
      cwd: "/work/app",
      startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      lastAt: Date.parse("2026-01-01T00:00:00.000Z"),
      firstPrompt: "Real work"
    });
  });
});
