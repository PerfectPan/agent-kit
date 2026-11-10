import { expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { claudeCodeSessionAdapter } from "../src/sessions.js";

it.each(["/logs/noise.jsonl", "/logs/foreign.db"])(
  "stops probing a non-Claude source near the head budget: %s",
  async (path) => {
    const base = createMemoryPlatform({ files: { [path]: "not json\n".repeat(40_000) }, chunkSize: 1024 });
    let bytes = 0;
    const platform = {
      ...base,
      fs: {
        ...base.fs,
        async *read(...args: Parameters<typeof base.fs.read>) {
          for await (const chunk of base.fs.read(...args)) {
            bytes += chunk.byteLength;
            yield chunk;
          }
        }
      }
    };
    expect(await claudeCodeSessionAdapter.detect(platform, { agent: "claude-code", path })).toBe(false);
    expect(bytes).toBeLessThanOrEqual(65 * 1024);
  }
);

it.each([
  ["/logs/foreign.db", "x".repeat(400_000)],
  ["/logs/foreign.jsonl", JSON.stringify("x".repeat(400_000))],
  ["/logs/foreign.jsonl", "\r\n  " + JSON.stringify(["x".repeat(400_000)])]
])("keeps disqualified first records bounded: %s", async (path, content) => {
  const base = createMemoryPlatform({ files: { [path]: content }, chunkSize: 1024 });
  let bytes = 0;
  const platform = {
    ...base,
    fs: {
      ...base.fs,
      async *read(...args: Parameters<typeof base.fs.read>) {
        for await (const chunk of base.fs.read(...args)) {
          bytes += chunk.byteLength;
          yield chunk;
        }
      }
    }
  };
  expect(await claudeCodeSessionAdapter.detect(platform, { agent: "claude-code", path })).toBe(false);
  expect(bytes).toBe(64 * 1024);
});

it("does not finish a foreign long second record after a short header", async () => {
  const path = "/logs/chats/session.jsonl";
  const header = JSON.stringify({ sessionId: "g", projectHash: "project", kind: "main" });
  const message = JSON.stringify({ id: "u", type: "user", content: "x".repeat(2 * 1024 * 1024) });
  const base = createMemoryPlatform({ files: { [path]: header + "\n" + message }, chunkSize: 1024 });
  let bytes = 0;
  const platform = {
    ...base,
    fs: {
      ...base.fs,
      async *read(...args: Parameters<typeof base.fs.read>) {
        for await (const chunk of base.fs.read(...args)) {
          bytes += chunk.byteLength;
          yield chunk;
        }
      }
    }
  };
  expect(await claudeCodeSessionAdapter.detect(platform, { agent: "claude-code", path })).toBe(false);
  expect(bytes).toBe(64 * 1024);
});
