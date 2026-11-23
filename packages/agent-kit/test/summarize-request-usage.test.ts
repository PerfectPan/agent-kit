import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { builtinProviders, type Provider } from "../src/providers.js";
import { loadTranscript, summarizeSession } from "../src/transcript.js";

const fixture = new URL("../../providers/claude-code/test/fixtures/sessions/conformance/subagent/", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, fixture), "utf8");
const dir = "/u/me/.claude/projects/-work";
const path = `${dir}/session.jsonl`;
const platform = createMemoryPlatform({
  files: {
    [path]: read("session.jsonl"),
    [`${dir}/session/subagents/agent-helper.jsonl`]: read("session/subagents/agent-helper.jsonl"),
    [`${dir}/session/subagents/agent-helper.meta.json`]: read("session/subagents/agent-helper.meta.json")
  }
});
const claude = builtinProviders.find((provider) => provider.id === "claude-code")!.sessions!;
const withSessions = (sessions: NonNullable<Provider["sessions"]>): Provider[] => [{ id: "claude-code", sessions }];

async function loadedRequestUsage(): Promise<unknown[]> {
  const loaded = await loadTranscript(platform, { agent: "claude-code", path });
  if (!loaded.ok) {
    throw new Error(loaded.error._tag);
  }
  return loaded.value.events.flatMap((event) => {
    if (event.kind !== "request") {
      return [];
    }
    const { model, usage, granularity, modelCalls, usageByModel, pricingMultiplier } = event.payload;
    return [
      Object.fromEntries(
        Object.entries({ model, usage, granularity, modelCalls, usageByModel, pricingMultiplier }).filter(
          ([, field]) => field !== undefined
        )
      )
    ];
  });
}

it("returns each request's billed fields only when asked, beside the prompts", async () => {
  const expected = await loadedRequestUsage();
  expect(expected.length).toBeGreaterThan(0);
  const prompts = { limit: 5, maxChars: 40 };
  const both = await summarizeSession(platform, { agent: "claude-code", path }, { prompts, requestUsage: true });
  expect(both.ok && both.value.requestUsage).toEqual(expected);
  expect(both.ok && both.value.prompts?.length).toBeGreaterThan(0);
  for (const requestUsage of [undefined, false]) {
    const plain = await summarizeSession(platform, { agent: "claude-code", path }, { prompts, requestUsage });
    expect(plain.ok && "requestUsage" in plain.value).toBe(false);
  }
});

it("reads the billed fields from the loaded transcript for an adapter without a summarize pass", async () => {
  const withoutPass = { ...claude, summarize: undefined };
  const summary = await summarizeSession(
    platform,
    { agent: "claude-code", path },
    { requestUsage: true, providers: withSessions(withoutPass) }
  );
  expect(summary.ok && summary.value.requestUsage).toEqual(await loadedRequestUsage());
});

it("leaves the billed fields out, not empty, when an adapter's summarize pass does not return them", async () => {
  const older = {
    ...claude,
    summarize: async (...args: Parameters<NonNullable<typeof claude.summarize>>) => {
      const summary = await claude.summarize!(...args);
      if (!summary.ok) {
        return summary;
      }
      const { requestUsage: _fields, ...rest } = summary.value;
      return { ok: true as const, value: rest };
    }
  };
  const summary = await summarizeSession(
    platform,
    { agent: "claude-code", path },
    { requestUsage: true, providers: withSessions(older) }
  );
  expect(summary.ok && "requestUsage" in summary.value).toBe(false);
});
