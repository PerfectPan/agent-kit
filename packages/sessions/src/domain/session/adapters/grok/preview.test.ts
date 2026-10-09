import { describe, expect, it } from "vite-plus/test";

import { grokSummaryFields, grokUsageSessionId, grokUsageSourceId } from "./layout.js";
import { applyGrokSummary, previewGrokRecords } from "./preview.js";
import type { SessionHead } from "../../index.js";

const summarySource = { file: "summary.json", offset: 0, length: 10, line: 1 };

describe("grok source identity", () => {
  it("identifies a usage source by its session directory, and names the session after the summary, else the directory", () => {
    expect(grokUsageSourceId("/h/sessions/cwd/s-1/updates.jsonl")).toBe("s-1");
    expect(grokUsageSessionId("from-summary", "/h/sessions/cwd/s-1/updates.jsonl")).toBe("from-summary");
    expect(grokUsageSessionId(undefined, "/h/sessions/cwd/s-1/updates.jsonl")).toBe("s-1");
  });
});

describe("applyGrokSummary", () => {
  it("overrides the previewed head with the summary's id, title, cwd and end time", () => {
    const head: SessionHead = {
      ref: { agent: "grok", path: "/h/sessions/cwd/s-1/updates.jsonl" },
      title: "first prompt".slice(0, 80),
      lastActiveAt: 10,
      sizeBytes: 1
    };
    applyGrokSummary(head, {
      id: "summary-id",
      title: "s".repeat(100),
      cwd: "/work",
      endedAt: 99
    });
    expect(head).toEqual({
      ref: { agent: "grok", path: "/h/sessions/cwd/s-1/updates.jsonl", sessionId: "summary-id" },
      title: "s".repeat(80),
      cwd: "/work",
      lastActiveAt: 99,
      sizeBytes: 1
    });
  });

  it("keeps the previewed head where the summary says nothing", () => {
    const head: SessionHead = {
      ref: { agent: "grok", path: "/h/sessions/cwd/s-1/updates.jsonl" },
      title: "kept",
      lastActiveAt: 10,
      sizeBytes: 1
    };
    applyGrokSummary(head, {});
    expect(head).toEqual({
      ref: { agent: "grok", path: "/h/sessions/cwd/s-1/updates.jsonl" },
      title: "kept",
      lastActiveAt: 10,
      sizeBytes: 1
    });
  });
});

describe("previewGrokRecords", () => {
  it("takes the first prompt from the first user chunk that is not injected", () => {
    const preview = previewGrokRecords([
      { timestamp: "2026-01-01T00:00:00.000Z", update: { sessionUpdate: "user_message_chunk", content: "hidden" } },
      {
        timestamp: 1767225601,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Real prompt" },
          _meta: { hideFromScrollback: true }
        }
      },
      {
        update: {
          sessionUpdate: "user_message_chunk",
          content: [{ type: "content", content: { type: "text", text: "Dele" }, text: "gate" }]
        }
      }
    ]);
    expect(preview).toEqual({ startedAt: 1767225600000, lastAt: 1767225601000, firstPrompt: "hidden" });
  });

  it("reads a field of an unexpected type as absent: no time, no text, no injected flag", () => {
    const preview = previewGrokRecords([
      { timestamp: "yesterday", update: { sessionUpdate: "user_message_chunk", content: { text: 5 } } },
      { timestamp: 1767225600, update: { sessionUpdate: 7, content: "not a chunk" } },
      {
        update: {
          sessionUpdate: "user_message_chunk",
          content: "Taken as a prompt",
          _meta: { hideFromScrollback: "yes" }
        }
      }
    ]);
    expect(preview).toEqual({ startedAt: 1767225600000, lastAt: 1767225600000, firstPrompt: "Taken as a prompt" });
  });
});

describe("grokSummaryFields", () => {
  it("reads the session fields and leaves the rest to the side files", () => {
    expect(
      grokSummaryFields(
        {
          chat_format_version: 1,
          generated_title: "Title",
          current_model_id: "grok-test",
          created_at: "2026-01-01T00:00:00.000Z",
          last_active_at: 1767225600,
          info: { id: "g-1", cwd: "/work" }
        },
        summarySource
      )
    ).toEqual({
      ok: true,
      value: {
        id: "g-1",
        title: "Title",
        cwd: "/work",
        startedAt: 1767225600000,
        endedAt: 1767225600000,
        model: "grok-test"
      }
    });
  });

  it("reads a field of an unexpected type as absent, and another generation as a tagged failure", () => {
    expect(
      grokSummaryFields({ info: { id: 5, cwd: "/work" }, generated_title: 7, created_at: true }, summarySource)
    ).toEqual({ ok: true, value: { cwd: "/work" } });
    expect(grokSummaryFields({ chat_format_version: "2" }, summarySource)).toEqual({
      ok: true,
      value: {}
    });
    expect(grokSummaryFields({ chat_format_version: 2 }, summarySource)).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: "summary.json", line: 1 }
    });
  });
});
