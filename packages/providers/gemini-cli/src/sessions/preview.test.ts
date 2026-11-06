import { describe, expect, it } from "vite-plus/test";

import { previewGeminiCliRecords } from "./preview.js";

describe("previewGeminiCliRecords", () => {
  it("spans the records' timestamps and takes the first user prompt with text", () => {
    expect(
      previewGeminiCliRecords([
        { sessionId: "s1", kind: "main" },
        { id: "u0", type: "user", content: "", timestamp: "2026-01-01T00:00:00.000Z" },
        { id: "g1", type: "gemini", content: "Hello", timestamp: "2026-01-01T00:00:01.000Z" },
        { id: "u1", type: "user", content: "Run the tests", timestamp: "2026-01-01T00:00:02.000Z" },
        { $set: { lastUpdated: "2026-01-01T00:00:03.000Z" } }
      ])
    ).toEqual({
      startedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      lastAt: Date.parse("2026-01-01T00:00:02.000Z"),
      firstPrompt: "Run the tests"
    });
  });
});
