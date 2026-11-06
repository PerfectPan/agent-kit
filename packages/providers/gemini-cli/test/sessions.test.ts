import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geminiCliSessionAdapter } from "../src/sessions.js";
import { translateGeminiCliRecords } from "../src/sessions/events.js";

function records(lines: string[]): { value: unknown; file: string; offset: number; length: number; line: number }[] {
  return lines.map((line, index) => ({
    value: JSON.parse(line) as unknown,
    file: "/chats/session-1.jsonl",
    offset: 0,
    length: line.length,
    line: index + 1
  }));
}

const line = (value: unknown): string => JSON.stringify(value);

describe("translateGeminiCliRecords", () => {
  it("turns a user prompt, a gemini reply's tokens and thinking items into their events", () => {
    const parsed = translateGeminiCliRecords(
      records([
        line({ sessionId: "s1", kind: "main" }),
        line({ id: "u1", type: "user", content: "Explain the change", timestamp: "2026-01-01T00:00:00.000Z" }),
        line({
          id: "g1",
          type: "gemini",
          content: "Here is why.",
          model: "gemini-3-pro",
          tokens: { input: 100, output: 20, cached: 0, thoughts: 5, tool: 0, total: 125 },
          timestamp: "2026-01-01T00:00:01.000Z"
        })
      ]),
      {}
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const kinds = parsed.value.events.map((event) => event.kind);
    expect(kinds).toEqual(["user", "request", "assistant"]);
    const request = parsed.value.events.find((event) => event.kind === "request");
    expect(request?.payload).toMatchObject({ granularity: "request", model: "gemini-3-pro" });
    expect(request?.payload.usage).toMatchObject({ inputTokens: 100, outputTokens: 25, reasoningTokens: 5 });
    expect(parsed.value.session).toMatchObject({ id: "s1" });
  });

  it("applies a later record with the same id in place and a $patch marker's content edit", () => {
    const parsed = translateGeminiCliRecords(
      records([
        line({ sessionId: "s1", kind: "main" }),
        line({
          id: "g1",
          type: "gemini",
          content: "Partial",
          model: "gemini-3-pro",
          timestamp: "2026-01-01T00:00:01.000Z"
        }),
        line({
          id: "g1",
          type: "gemini",
          content: "Full",
          model: "gemini-3-pro",
          timestamp: "2026-01-01T00:00:02.000Z"
        }),
        line({ $patch: { id: "g1", content: "Edited final" } })
      ]),
      {}
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const assistants = parsed.value.events.filter((event) => event.kind === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.payload.text).toBe("Edited final");
    expect(parsed.value.skipped.map((skip) => skip.reason)).toEqual(["chat-header", "message-update", "message-patch"]);
  });

  it("merges a tool call's later records into one call and one result", () => {
    const parsed = translateGeminiCliRecords(
      records([
        line({ sessionId: "s1", kind: "main" }),
        line({
          id: "g1",
          type: "gemini",
          content: "",
          model: "gemini-test",
          toolCalls: [{ id: "t1", name: "shell", args: { command: "npm test" } }],
          timestamp: "2026-01-01T00:00:01.000Z"
        }),
        line({
          id: "g1",
          type: "gemini",
          content: "",
          model: "gemini-test",
          toolCalls: [{ id: "t1", name: "shell", status: "error", resultDisplay: "1 failed" }],
          timestamp: "2026-01-01T00:00:02.000Z"
        })
      ]),
      {}
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const kinds = parsed.value.events.map((event) => event.kind);
    expect(kinds).toEqual(["assistant", "tool_call", "tool_result"]);
    const result = parsed.value.events.find((event) => event.kind === "tool_result");
    expect(result?.payload).toMatchObject({ callId: "t1", isError: true, output: "1 failed" });
  });

  it("skips records that are not objects instead of failing the chat", () => {
    const parsed = translateGeminiCliRecords(
      records([
        "null",
        '"text"',
        "42",
        "[]",
        line({ id: "u1", type: "user", content: "hi", timestamp: "2026-01-01T00:00:00.000Z" })
      ]),
      {}
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.events.map((event) => event.kind)).toEqual(["user"]);
    expect(parsed.value.skipped.map((skip) => skip.reason)).toEqual(Array(4).fill("invalid-record"));
  });

  it("drops tool calls without a string id instead of merging them or failing the chat", () => {
    const parsed = translateGeminiCliRecords(
      records([
        line({
          id: "g1",
          type: "gemini",
          content: "",
          toolCalls: [
            { id: { toString: null }, name: "shell", status: "success" },
            { name: "read_file", status: "success" },
            { name: "glob", status: "success" },
            { id: "t1", name: { toString: null }, status: "success" }
          ],
          timestamp: "2026-01-01T00:00:01.000Z"
        })
      ]),
      {}
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const calls = parsed.value.events.filter((event) => event.kind === "tool_call");
    expect(calls.map((event) => event.payload)).toEqual([{ callId: "t1", name: "" }]);
    expect(parsed.value.skipped.map((skip) => skip.reason)).toEqual(Array(3).fill("invalid-tool-call"));
  });
});

describe("geminiCliSessionAdapter", () => {
  it("loads a legacy .json chat with its object's session id", async () => {
    const fixture = readFileSync(
      fileURLToPath(new URL("fixtures/sessions/legacy-json/chats/session-1.json", import.meta.url)),
      "utf8"
    );
    const platform = createMemoryPlatform({
      files: { "/gemini/legacy/chats/session-1.json": new TextEncoder().encode(fixture) }
    });
    const loaded = await geminiCliSessionAdapter.load(platform, {
      agent: "gemini-cli",
      path: "/gemini/legacy/chats/session-1.json"
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.session.id).toBe("legacy-session");
    expect(loaded.value.events.map((event) => event.kind)).toEqual(["user", "request", "assistant", "user"]);
  });

  it("skips a legacy chat's messages that are not objects", async () => {
    const chat = { sessionId: "legacy", messages: [null, "text", { id: "u1", type: "user", content: "hi" }] };
    const platform = createMemoryPlatform({
      files: { "/gemini/legacy/chats/session-1.json": new TextEncoder().encode(JSON.stringify(chat)) }
    });
    const loaded = await geminiCliSessionAdapter.load(platform, {
      agent: "gemini-cli",
      path: "/gemini/legacy/chats/session-1.json"
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.events.map((event) => event.kind)).toEqual(["user"]);
    expect(loaded.value.skipped.map((skip) => skip.reason)).toEqual(["invalid-record", "invalid-record"]);
  });

  it("reports a chat's lines that are not JSON as skipped", async () => {
    const text = [
      line({ sessionId: "s1", kind: "main" }),
      "{not json",
      line({ id: "u1", type: "user", content: "hi" })
    ];
    const platform = createMemoryPlatform({
      files: { "/gemini/tmp/p/chats/session-1.jsonl": new TextEncoder().encode(text.join("\n")) }
    });
    const loaded = await geminiCliSessionAdapter.load(platform, {
      agent: "gemini-cli",
      path: "/gemini/tmp/p/chats/session-1.jsonl"
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.skipped.map((skip) => [skip.reason, skip.source.line])).toEqual([
      ["chat-header", 1],
      ["invalid-json", 2]
    ]);
  });

  it("returns SessionNotFound for a chat file that does not exist", async () => {
    const platform = createMemoryPlatform({ files: {} });
    const loaded = await geminiCliSessionAdapter.load(platform, {
      agent: "gemini-cli",
      path: "/gemini/tmp/p/chats/session-1.jsonl"
    });
    expect(loaded).toMatchObject({ ok: false, error: { _tag: "SessionNotFound" } });
  });

  it("detects chats under a chats directory and rejects other files", async () => {
    const platform = createMemoryPlatform({
      files: {
        "/gemini/tmp/p/chats/session-1.jsonl": new TextEncoder().encode("{}"),
        "/gemini/tmp/p/other.json": new TextEncoder().encode("{}")
      }
    });
    expect(
      await geminiCliSessionAdapter.detect(platform, {
        agent: "gemini-cli",
        path: "/gemini/tmp/p/chats/session-1.jsonl"
      })
    ).toBe(true);
    expect(
      await geminiCliSessionAdapter.detect(platform, { agent: "gemini-cli", path: "/gemini/tmp/p/other.json" })
    ).toBe(false);
  });
});
