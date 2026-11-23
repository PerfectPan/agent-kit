import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { builtinProviders } from "../src/providers.js";
import { isSessionHead, listSessions, sessionAdapterHome } from "../src/sessions.js";
import { loadTranscript, summarizeSession } from "../src/transcript.js";

const fixture = new URL("../../providers/claude-code/test/fixtures/sessions/conformance/subagent/", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, fixture), "utf8");
const project = "C:/Users/me/.claude/projects/-C-work";
const files = {
  [`${project}/session.jsonl`]: read("session.jsonl"),
  [`${project}/session/subagents/agent-helper.jsonl`]: read("session/subagents/agent-helper.jsonl"),
  [`${project}/session/subagents/agent-helper.meta.json`]: read("session/subagents/agent-helper.meta.json")
};
const claude = builtinProviders.find((provider) => provider.id === "claude-code")!.sessions!;

it("reads a Windows target typed with backslashes as the same session, subagents included", async () => {
  const platform = createMemoryPlatform({ files, home: "C:\\Users\\me", os: "win32" });
  const typed = await loadTranscript(platform, {
    agent: "claude-code",
    path: "C:\\Users\\me\\.claude\\projects\\-C-work\\session.jsonl"
  });
  const slashed = await loadTranscript(platform, { agent: "claude-code", path: `${project}/session.jsonl` });
  expect(typed.ok).toBe(true);
  expect(typed).toEqual(slashed);
  expect(typed.ok && typed.value.agents.length).toBeGreaterThan(1);
  expect(typed.ok && new Set(typed.value.events.map((event) => event.source.file))).toEqual(
    new Set([`${project}/session.jsonl`, `${project}/session/subagents/agent-helper.jsonl`])
  );
  expect(
    await summarizeSession(platform, { path: "C:\\Users\\me\\.claude\\projects\\-C-work\\session.jsonl" })
  ).toEqual(await summarizeSession(platform, { path: `${project}/session.jsonl` }));
});

it("lists Windows sessions under a backslash home with forward slashes only", async () => {
  const platform = createMemoryPlatform({ files, home: "C:\\Users\\me", os: "win32" });
  expect(sessionAdapterHome(claude, platform).path).toBe("C:/Users/me/.claude");
  expect(sessionAdapterHome(claude, { ...platform, env: { CLAUDE_CONFIG_DIR: "D:\\agents\\claude" } }).path).toBe(
    "D:/agents/claude"
  );
  const paths: string[] = [];
  for await (const item of listSessions(platform, { agents: ["claude-code"] })) {
    if (isSessionHead(item)) {
      paths.push(item.ref.path);
    }
  }
  expect(paths).toEqual([`${project}/session.jsonl`]);
});

it("keeps a backslash as a filename character on other systems", () => {
  const platform = createMemoryPlatform({ home: "/u/a\\b", os: "linux" });
  expect(sessionAdapterHome(claude, platform).path).toBe("/u/a\\b/.claude");
  expect(sessionAdapterHome(claude, { env: {}, home: "C:\\Users\\me" }).path).toBe("C:\\Users\\me/.claude");
});
