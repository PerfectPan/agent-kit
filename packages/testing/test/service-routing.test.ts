import { builtinSessionAdapters } from "./providers.js";
import { err, type CodingAgent } from "@rivus/agent-kit-catalog";
import { detectAgents } from "@rivus/agent-kit-discovery";
import { builtinProbeRecipes } from "./providers.js";
import { type HookDialect, readHookEvent } from "@rivus/agent-kit-harness";
import {
  decodeUsage,
  listSessions,
  listUsageSources,
  loadTranscript,
  scanUsage,
  type SessionAdapter,
  type UsageDecoder,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { builtinUsageDecoders } from "./providers.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { hookDialectConformance } from "../src/hook-dialect-conformance.js";
import { probeRecipeConformance } from "../src/probe-recipe-conformance.js";
import { createMemoryPlatform } from "../src/memory-platform.js";

const identity: CodingAgent = {
  id: "custom",
  displayName: "Custom",
  aliases: ["alias"],
  home: { defaultPath: [".custom"] }
};
const identities = { custom: identity };
const platform = createMemoryPlatform({ home: "/user", files: { "/session": "{}", "/user/.custom/config": "{}" } });
const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = [];
  for await (const item of items) {
    result.push(item);
  }
  return result;
};

it("routes sessions and homes through only the supplied tables", async () => {
  const roots = vi.fn<SessionAdapter["roots"]>(() => []);
  const load = vi.fn<SessionAdapter["load"]>(async () => err({ _tag: "SessionNotFound", path: "/custom" }));
  const adapter: SessionAdapter = { ...builtinSessionAdapters.codex, agent: "custom", home: undefined, roots, load };
  const providers = { sessions: { custom: adapter }, identity: identities };
  await collect(listSessions(platform, { agents: ["alias"], providers }));
  expect(roots).toHaveBeenCalledWith(expect.objectContaining({ path: "/user/.custom" }));
  expect(await loadTranscript(platform, { agent: "alias", path: "/session" }, { providers })).toEqual({
    ok: false,
    error: { _tag: "SessionNotFound", path: "/custom" }
  });
  expect(load).toHaveBeenCalledOnce();
  expect(await loadTranscript(platform, { agent: "codex", path: "/session" }, { providers })).toEqual({
    ok: false,
    error: { _tag: "CapabilityUnsupported", agent: "codex" }
  });
  await expect(collect(listSessions(platform, { agents: ["codex"], providers }))).rejects.toMatchObject({
    code: "capability-unsupported"
  });
});

it("routes decoding, source discovery and scan deduplication through the supplied usage service", async () => {
  const record: UsageRecord = {
    agent: "custom",
    sessionId: "s",
    granularity: "request",
    timestamp: 1,
    usage: { inputTokens: 3 },
    source: { file: "/usage", offset: 0, length: 1, line: 1 }
  };
  const decode = vi.fn<UsageDecoder["decode"]>(() => ({
    cursor: undefined,
    async *[Symbol.asyncIterator]() {
      yield record;
      yield record;
    }
  }));
  const sources = vi.fn<UsageDecoder["sources"]>(async function* () {
    yield { agent: "custom", id: "s", path: "/usage", mtimeMs: 1 };
  });
  const usageKey = vi.fn<UsageDecoder["usageKey"]>(() => "same-request");
  const decoder: UsageDecoder = {
    ...builtinUsageDecoders.codex,
    agent: "custom",
    home: undefined,
    decode,
    sources,
    usageKey
  };
  const providers = { usage: { custom: decoder }, identity: identities };
  expect(await collect(decodeUsage(platform, "alias", { path: "/usage" }, { providers }))).toEqual([record, record]);
  expect(await collect(listUsageSources(platform, { agents: ["alias"], providers }))).toHaveLength(1);
  expect(sources.mock.calls[0]?.[1]).toMatchObject({ path: "/user/.custom" });
  expect(await collect(scanUsage(platform, { agents: ["alias"], providers }))).toEqual([record]);
  expect(usageKey).toHaveBeenCalledTimes(2);
  expect(await collect(decodeUsage(platform, "codex", { path: "/usage" }, { providers }))).toEqual([
    { agent: "codex", path: "/usage", error: { _tag: "CapabilityUnsupported", agent: "codex" } }
  ]);
  await expect(collect(listUsageSources(platform, { agents: ["codex"], providers }))).rejects.toMatchObject({
    code: "capability-unsupported"
  });
});

it("detects aliases and expands homes from the supplied identities, with no built-in fallback", async () => {
  const recipe = {
    ...builtinProbeRecipes.codex,
    agent: "custom",
    displayName: "Custom",
    home: undefined,
    auth: undefined,
    commands: [],
    appPaths: [],
    mcpConfigPaths: [],
    configPaths: [{ agentHome: "custom", path: "config" }]
  };
  const providers = { discovery: { custom: recipe }, identity: identities };
  expect(await detectAgents(platform, { agents: ["alias"], providers })).toMatchObject([
    { agent: "custom", status: "found", evidence: [{ kind: "config", path: "/user/.custom/config" }] }
  ]);
  await expect(detectAgents(platform, { agents: ["codex"], providers })).rejects.toMatchObject({
    code: "capability-unsupported"
  });
});

const dialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "declared",
  delivery: "plugin",
  fields: { event: { paths: [["event"]] } },
  events: { start: { lifecycle: { phase: "start" } } }
};
const first: HookDialect = {
  ...dialect,
  agent: "first",
  hostMarkers: { payloadFields: ["firstMarker"], env: ["FIRST_HOST"] },
  runsHooksOf: [{ agent: "declared", files: ["~/settings"], byDefault: true, events: { start: "start" } }]
};
const second: HookDialect = { ...first, agent: "second", hostMarkers: { payloadFields: ["secondMarker"] } };
const hooks = { declared: dialect, first, second };

describe("declared host markers", () => {
  it("prioritizes all payload markers over env markers, then hooks table order", () => {
    expect(
      readHookEvent(
        "declared",
        { event: "start", secondMarker: "yes" },
        { FIRST_HOST: "yes" },
        { providers: { hooks } }
      ).agent
    ).toBe("second");
    expect(
      readHookEvent("declared", { firstMarker: "yes", secondMarker: "yes" }, {}, { providers: { hooks } }).agent
    ).toBe("first");
    expect(
      readHookEvent(
        "declared",
        { firstMarker: "yes", secondMarker: "yes" },
        {},
        { providers: { hooks: { second, first, declared: dialect } } }
      ).agent
    ).toBe("second");
  });
  it("uses env markers only for declared foreign hook relationships and ignores empty markers", () => {
    expect(readHookEvent("declared", {}, { FIRST_HOST: "yes" }, { providers: { hooks } }).agent).toBe("first");
    expect(readHookEvent("second", {}, { FIRST_HOST: "yes" }, { providers: { hooks } }).agent).toBe("second");
    expect(readHookEvent("declared", { firstMarker: "" }, { FIRST_HOST: "" }, { providers: { hooks } }).agent).toBe(
      "declared"
    );
  });
});

it("runs hook conformance with the supplied host table", async () => {
  const checks = hookDialectConformance(
    dialect,
    {
      samples: [
        {
          name: "foreign host",
          payload: { event: "start", firstMarker: "yes" },
          expected: { agent: "first", phase: "start", nativeEvent: "start" }
        }
      ]
    },
    { first }
  );
  for (const check of checks) {
    await expect(check.run()).resolves.toBeUndefined();
  }
});

it("checks probe conformance against the supplied identity table", async () => {
  const recipe = { ...builtinProbeRecipes.codex, agent: "custom", displayName: "Different" };
  const checks = probeRecipeConformance(recipe, {}, identities);
  await expect(checks[0]!.run()).rejects.toThrow("catalog says Custom");
  const accepted = probeRecipeConformance({ ...recipe, displayName: "Custom" }, {}, identities);
  await expect(accepted[0]!.run()).resolves.toBeUndefined();
});
