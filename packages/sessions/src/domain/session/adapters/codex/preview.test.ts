import { describe, expect, it } from "vitest";

import { previewCodexRecords } from "./preview.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("previewCodexRecords", () => {
  it("reads a field of an unexpected type as absent", () => {
    const preview = previewCodexRecords([
      { timestamp: AT, type: "session_meta", payload: { id: 5, session_id: null, cwd: 7 } },
      { type: "response_item", payload: { type: "message", role: "user", content: 5 } }
    ]);
    expect(preview.sessionId).toBeUndefined();
    expect(preview.cwd).toBeUndefined();
    expect(preview.firstPrompt).toBeUndefined();
    // The record's time is of a known shape, so it still starts the session.
    expect([preview.startedAt, preview.lastAt]).toEqual([Date.parse(AT), Date.parse(AT)]);
  });

  it("names the session and cwd of a payload, and the first prompt of a bare user message", () => {
    expect(
      previewCodexRecords([
        { timestamp: AT, type: "session_meta", payload: { id: "cx-1", cwd: "/work/app" } },
        { type: "message", role: "user", content: [{ type: "input_text", text: "List the files" }] }
      ])
    ).toEqual({
      sessionId: "cx-1",
      cwd: "/work/app",
      startedAt: Date.parse(AT),
      lastAt: Date.parse(AT),
      firstPrompt: "List the files"
    });
  });
});
