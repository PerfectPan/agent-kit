import { describe, expect, it } from "vitest";

import { SESSION_TITLE_MAX, sessionHead } from "./session-head.js";
import type { SessionPreview } from "../value-objects/session-preview.js";

const ref = { agent: "codex" as const, path: "/r/rollout-1.jsonl" };
const file = { sizeBytes: 120, mtimeMs: 70 };

describe("sessionHead", () => {
  it("prefers the agent's own title over the first prompt, cut to 80 characters", () => {
    const head = sessionHead(ref, { title: "agent title", firstPrompt: "the prompt" }, file);
    expect(head.title).toBe("agent title");
    expect(head.title?.length).toBeLessThanOrEqual(SESSION_TITLE_MAX);
    const prompted = sessionHead(ref, { firstPrompt: "x".repeat(SESSION_TITLE_MAX + 20) }, file);
    expect(prompted.title).toBe("x".repeat(SESSION_TITLE_MAX));
    expect(prompted.firstPrompt).toHaveLength(SESSION_TITLE_MAX + 20);
  });

  it("takes the last activity from the records, else from the file", () => {
    expect(sessionHead(ref, { lastAt: 42 }, file).lastActiveAt).toBe(42);
    expect(sessionHead(ref, {}, file).lastActiveAt).toBe(70);
  });

  it("keeps what the preview read, with the ref the caller built from it", () => {
    const preview: SessionPreview = { sessionId: "s1", cwd: "/w", startedAt: 5, firstPrompt: "hi" };
    expect(sessionHead({ agent: "codex", path: "/r/rollout-1.jsonl", sessionId: "s1" }, preview, file)).toEqual({
      ref: { agent: "codex", path: "/r/rollout-1.jsonl", sessionId: "s1" },
      lastActiveAt: 70,
      sizeBytes: 120,
      title: "hi",
      cwd: "/w",
      startedAt: 5,
      firstPrompt: "hi"
    });
    expect(sessionHead(ref, {}, file).ref).toEqual(ref);
  });
});
