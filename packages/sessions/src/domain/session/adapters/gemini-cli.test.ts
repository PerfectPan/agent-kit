import { describe, expect, it } from "vite-plus/test";

import { isGeminiCliUsageSource } from "./gemini-cli.js";

describe("gemini-cli usage sources", () => {
  it("keeps a .jsonl chat, and an older .json chat only until its migrated .jsonl sibling exists", () => {
    const listed = new Set(["/h/tmp/p/chats/session-1.json", "/h/tmp/p/chats/session-1.jsonl"]);
    expect(isGeminiCliUsageSource("/h/tmp/p/chats/session-1.jsonl", listed)).toBe(true);
    expect(isGeminiCliUsageSource("/h/tmp/p/chats/session-1.json", listed)).toBe(false);
    expect(isGeminiCliUsageSource("/h/tmp/p/chats/session-2.json", new Set())).toBe(true);
    expect(isGeminiCliUsageSource("/h/tmp/p/other/session-3.jsonl", new Set())).toBe(false);
  });
});
