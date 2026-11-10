import { expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { loadTranscript, summarizeSession } from "../src/transcript.js";
import { builtinProviders, type Provider } from "../src/providers.js";

const geminiMessages = [
  { id: "u1", type: "user", content: "Explain", timestamp: "2026-01-01T00:00:00.000Z" },
  {
    id: "g1",
    type: "gemini",
    content: "Done",
    model: "gemini-test",
    timestamp: "2026-01-01T00:00:01.000Z",
    tokens: { input: 12, output: 3 }
  }
];
const geminiHeader = { sessionId: "g1", projectHash: "project", kind: "main" };
const custom: Provider = {
  id: "custom",
  sessions: {
    ...builtinProviders.find((provider) => provider.id === "pi")!.sessions!,
    agent: "custom",
    detect: async () => false
  }
};

it.each(["jsonl", "json", "pretty-json"])(
  "routes %s Gemini chats through the same reader with inferred, explicit, and extended providers",
  async (format) => {
    const path = "/logs/chats/session-1." + (format === "jsonl" ? "jsonl" : "json");
    const text =
      format === "jsonl"
        ? [geminiHeader, ...geminiMessages].map((record) => JSON.stringify(record)).join("\n")
        : JSON.stringify({ ...geminiHeader, messages: geminiMessages }, null, format === "pretty-json" ? 2 : undefined);
    const platform = createMemoryPlatform({ files: { [path]: text }, chunkSize: 128 });
    const named = await loadTranscript(platform, { path, agent: "gemini-cli" });
    expect(named.ok && named.value.agent).toBe("gemini-cli");
    expect(named.ok && named.value.events.length).toBeGreaterThan(0);
    expect(await loadTranscript(platform, { path })).toEqual(named);
    expect(await loadTranscript(platform, { path }, { providers: [custom] })).toEqual(named);
    expect(await summarizeSession(platform, { path })).toEqual(
      await summarizeSession(platform, { path, agent: "gemini-cli" })
    );
    const forced = await loadTranscript(platform, { path, agent: "claude-code" });
    const claude = builtinProviders.find((provider) => provider.id === "claude-code")!.sessions!;
    expect(forced).toEqual(await claude.load(platform, { path, agent: "claude-code" }));
  }
);

it.each([
  [10, ""],
  [100_000, ""],
  [100_000, "\r\n\r\n"]
] as const)("keeps relocated Claude records under chats with a %i-character first prompt", async (size, prefix) => {
  const path = "/logs/chats/claude.jsonl";
  const text =
    JSON.stringify({
      type: "user",
      uuid: "u1",
      sessionId: "c1",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "x".repeat(size) }
    }) + "\n";
  const platform = createMemoryPlatform({ files: { [path]: prefix + text }, chunkSize: 1024 });
  const named = await loadTranscript(platform, { path, agent: "claude-code" });
  expect(named.ok && named.value.events).toHaveLength(1);
  expect(await loadTranscript(platform, { path })).toEqual(named);
});

it("keeps recognizable unknown Claude generations on the fail-loud path", async () => {
  const path = "/logs/moved.jsonl";
  const platform = createMemoryPlatform({
    files: { [path]: JSON.stringify({ type: "user", sessionId: "c1", uuid: "u1", formatVersion: 2 }) }
  });
  expect(await loadTranscript(platform, { path })).toMatchObject({
    ok: false,
    error: { _tag: "UnknownFormatGeneration", agent: "claude-code" }
  });
});
