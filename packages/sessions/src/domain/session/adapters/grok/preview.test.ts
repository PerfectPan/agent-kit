import { describe, expect, it } from "vitest";

import { grokUsageSessionId, grokUsageSourceId } from "./layout.js";
import { applyGrokSummary } from "./preview.js";
import type { SessionHead } from "../../index.js";

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
