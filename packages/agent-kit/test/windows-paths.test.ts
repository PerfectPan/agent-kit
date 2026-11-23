import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { builtinProviders } from "../src/providers.js";
import { isSessionHead, listSessions, sessionAdapterHome } from "../src/sessions.js";
import { loadTranscript, summarizeSession } from "../src/transcript.js";
import { isUsageRecord, scanUsage } from "../src/transcript/usage.js";

const fixtures = new URL("../../providers/", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, fixtures), "utf8");
const subagent = "claude-code/test/fixtures/sessions/conformance/subagent/";
const project = "C:/Users/me/.claude/projects/-C-work";
const claudeFiles = (dir: string) => ({
  [`${dir}/session.jsonl`]: read(`${subagent}session.jsonl`),
  [`${dir}/session/subagents/agent-helper.jsonl`]: read(`${subagent}session/subagents/agent-helper.jsonl`),
  [`${dir}/session/subagents/agent-helper.meta.json`]: read(`${subagent}session/subagents/agent-helper.meta.json`)
});
const rollout = "C:/Users/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-features.jsonl";
const files = {
  ...claudeFiles(project),
  [rollout]: read("codex/test/fixtures/sessions/conformance/rollout-features.jsonl")
};
const claude = builtinProviders.find((provider) => provider.id === "claude-code")!.sessions!;
const typed = (path: string): string => path.replaceAll("/", "\\");

it("reads a Windows target typed with backslashes as the same session, subagents included", async () => {
  const platform = createMemoryPlatform({ files, home: "C:\\Users\\me", os: "win32" });
  const path = `${project}/session.jsonl`;
  const loaded = await loadTranscript(platform, { agent: "claude-code", path: typed(path) });
  expect(loaded.ok).toBe(true);
  expect(loaded).toEqual(await loadTranscript(platform, { agent: "claude-code", path }));
  expect(loaded.ok && loaded.value.agents.length).toBeGreaterThan(1);
  expect(loaded.ok && new Set(loaded.value.events.map((event) => event.source.file))).toEqual(
    new Set([path, `${project}/session/subagents/agent-helper.jsonl`])
  );
  expect(await summarizeSession(platform, { path: typed(path) })).toEqual(await summarizeSession(platform, { path }));
});

it("detects a Codex rollout typed with backslashes by its file name", async () => {
  const platform = createMemoryPlatform({ files, home: "C:\\Users\\me", os: "win32" });
  const loaded = await loadTranscript(platform, { path: typed(rollout) });
  expect(loaded.ok && loaded.value.agent).toBe("codex");
  expect(loaded).toEqual(await loadTranscript(platform, { path: rollout }));
});

it("lists Windows sessions under a backslash home with forward slashes only", async () => {
  const override = "D:/agents/claude/projects/-C-work";
  const platform = createMemoryPlatform({
    files: { ...files, ...claudeFiles(override) },
    home: "C:\\Users\\me",
    os: "win32"
  });
  const listed = async (env: Record<string, string>): Promise<string[]> => {
    const paths: string[] = [];
    for await (const item of listSessions({ ...platform, env }, { agents: ["claude-code"] })) {
      if (isSessionHead(item)) {
        paths.push(item.ref.path);
      }
    }
    return paths;
  };
  expect(await listed({})).toEqual([`${project}/session.jsonl`]);
  expect(await listed({ CLAUDE_CONFIG_DIR: "D:\\agents\\claude" })).toEqual([`${override}/session.jsonl`]);
});

it("keeps the spelling of the homes sessionAdapterHome and usage scans return", async () => {
  const usage = "C:\\Users\\me/.claude/projects/-C-work/s-usage.jsonl";
  const platform = createMemoryPlatform({
    files: { [usage]: read("claude-code/test/fixtures/usage/projects/-u-me-work/s-usage.jsonl") },
    home: "C:\\Users\\me",
    os: "win32",
    // The file was last written a day ago, so the scan reads it as finished and reports its last requests.
    now: (() => {
      let time = Date.now() - 86_400_000;
      return () => (time += 3_600_000);
    })()
  });
  expect(sessionAdapterHome(claude, platform).path).toBe("C:\\Users\\me/.claude");
  const sources = new Set<string>();
  for await (const item of scanUsage(platform, { agents: ["claude-code"], since: 0 })) {
    if (isUsageRecord(item)) {
      sources.add(item.source.file);
    }
  }
  expect(sources).toEqual(new Set([usage]));
});

it("keeps a backslash as a filename character on other systems", async () => {
  const platform = createMemoryPlatform({
    files: { "/u/a\\b/s.jsonl": read(`${subagent}session.jsonl`) },
    os: "linux"
  });
  const loaded = await loadTranscript(platform, { agent: "claude-code", path: "/u/a\\b/s.jsonl" });
  expect(loaded.ok && loaded.value.events[0]?.source.file).toBe("/u/a\\b/s.jsonl");
  expect(await loadTranscript(platform, { agent: "claude-code", path: "/u/a/b/s.jsonl" })).toMatchObject({
    ok: false,
    error: { _tag: "SessionNotFound" }
  });
});
