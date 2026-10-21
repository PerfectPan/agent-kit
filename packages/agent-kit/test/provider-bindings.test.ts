import { acpTable } from "../src/providers/acp.js";
import { usageTable } from "../src/providers/usage.js";
import { sessionsTable } from "../src/providers/sessions.js";
import { builtinInstallAdapters } from "../src/providers/install.js";
import { builtinHookDialects } from "../src/providers/hooks.js";
import { builtinProbeRecipes } from "../src/providers/discovery.js";
import { describe, expect, it, vi } from "vite-plus/test";
import * as sessions from "@rivus/agent-kit-sessions/public";
import * as discovery from "@rivus/agent-kit-discovery/public";
import * as events from "@rivus/agent-kit-harness/public/events";
import * as harness from "@rivus/agent-kit-harness/public";
import * as acp from "@rivus/agent-kit-acp/public";
import * as testing from "@rivus/agent-kit-testing/public";
import { listSessions, sessionAdapterHome } from "../src/sessions.js";
import { detectAgents } from "../src/discovery.js";
import { loadTranscript, summarizeSession } from "../src/transcript.js";
import { decodeUsage, listUsageSources, scanUsage } from "../src/transcript/usage.js";
import { readHookEvent } from "../src/harness/events.js";
import { planInstall, findLegacy, verify, uninstall, doctor } from "../src/harness.js";
import { connectAgent, probeAgent } from "../src/acp.js";
import { hookDialectConformance, probeRecipeConformance } from "../src/testing.js";
import type { Provider } from "../src/providers.js";
import { builtinCodingAgents } from "../src/providers/identity.js";
vi.mock("@rivus/agent-kit-sessions/public", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-sessions/public")>()),
  listSessions: vi.fn<typeof sessions.listSessions>(),
  sessionAdapterHome: vi.fn<typeof sessions.sessionAdapterHome>(),
  loadTranscript: vi.fn<typeof sessions.loadTranscript>(),
  summarizeSession: vi.fn<typeof sessions.summarizeSession>(),
  decodeUsage: vi.fn<typeof sessions.decodeUsage>(),
  listUsageSources: vi.fn<typeof sessions.listUsageSources>(),
  scanUsage: vi.fn<typeof sessions.scanUsage>()
}));
vi.mock("@rivus/agent-kit-discovery/public", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-discovery/public")>()),
  detectAgents: vi.fn<typeof discovery.detectAgents>()
}));
vi.mock("@rivus/agent-kit-harness/public/events", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-harness/public/events")>()),
  readHookEvent: vi.fn<typeof events.readHookEvent>()
}));
vi.mock("@rivus/agent-kit-harness/public", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-harness/public")>()),
  planInstall: vi.fn<typeof harness.planInstall>(),
  findLegacy: vi.fn<typeof harness.findLegacy>(),
  verify: vi.fn<typeof harness.verify>(),
  uninstall: vi.fn<typeof harness.uninstall>(),
  doctor: vi.fn<typeof harness.doctor>()
}));
vi.mock("@rivus/agent-kit-acp/public", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-acp/public")>()),
  connectAgent: vi.fn<typeof acp.connectAgent>(),
  probeAgent: vi.fn<typeof acp.probeAgent>()
}));
vi.mock("@rivus/agent-kit-testing/public", async (original) => ({
  ...(await original<typeof import("@rivus/agent-kit-testing/public")>()),
  hookDialectConformance: vi.fn<typeof testing.hookDialectConformance>(),
  probeRecipeConformance: vi.fn<typeof testing.probeRecipeConformance>()
}));

const expectedProvider = (id: "codex" | "grok"): Provider => ({
  id,
  identity: builtinCodingAgents[id],
  discovery: builtinProbeRecipes[id],
  hooks: builtinHookDialects[id],
  install: builtinInstallAdapters[id],
  sessions: sessionsTable()[id],
  usage: usageTable()[id],
  acp: acpTable()[id]
});
const builtin = expectedProvider("codex");
const other = expectedProvider("grok");
const platform = testing.createMemoryPlatform();
const bundle = { owner: "test-app", version: "1", digest: "test", artifacts: [] };
type Service = Exclude<keyof Provider, "id">;
type Table = Readonly<Partial<Record<string, unknown>>>;
const overrides: Provider = {
  id: builtin.id,
  identity: { ...builtin.identity!, aliases: ["custom-alias"] },
  sessions: { ...builtin.sessions! },
  usage: { ...builtin.usage! },
  hooks: { ...builtin.hooks! },
  install: { ...builtin.install! },
  discovery: { ...builtin.discovery! },
  acp: { ...builtin.acp! }
};

function captured(
  spy: (...args: never[]) => unknown,
  index: number,
  service?: Service
): Partial<Record<Service, Table>> {
  const calls: readonly (readonly unknown[])[] = vi.mocked(spy).mock.calls;
  const value = calls.at(-1)?.[index];
  return service === undefined
    ? (value as { providers: Partial<Record<Service, Table>> }).providers
    : { [service]: value as Table };
}

const bindings: readonly {
  name: string;
  services: readonly Service[];
  call: (providers?: readonly Provider[]) => void;
  read: () => Partial<Record<Service, Table>>;
}[] = [
  {
    name: "listSessions",
    services: ["sessions", "identity"],
    call: (providers) => {
      listSessions(platform, { providers });
    },
    read: () => captured(sessions.listSessions, 1)
  },
  {
    name: "sessionAdapterHome",
    services: ["identity"],
    call: (providers) => {
      sessionAdapterHome(builtin.sessions!, platform, { providers });
    },
    read: () => captured(sessions.sessionAdapterHome, 2, "identity")
  },
  {
    name: "detectAgents",
    services: ["discovery", "identity"],
    call: (providers) => {
      void detectAgents(platform, { providers });
    },
    read: () => captured(discovery.detectAgents, 1)
  },
  {
    name: "loadTranscript",
    services: ["sessions", "identity"],
    call: (providers) => {
      void loadTranscript(platform, { path: "/session" }, { providers });
    },
    read: () => captured(sessions.loadTranscript, 2)
  },
  {
    name: "summarizeSession",
    services: ["sessions", "identity"],
    call: (providers) => {
      void summarizeSession(platform, { path: "/session" }, { providers });
    },
    read: () => captured(sessions.summarizeSession, 2)
  },
  {
    name: "decodeUsage",
    services: ["usage", "identity"],
    call: (providers) => {
      decodeUsage(platform, "codex", { path: "/usage" }, { providers });
    },
    read: () => captured(sessions.decodeUsage, 3)
  },
  {
    name: "listUsageSources",
    services: ["usage", "identity"],
    call: (providers) => {
      listUsageSources(platform, { providers });
    },
    read: () => captured(sessions.listUsageSources, 1)
  },
  {
    name: "scanUsage",
    services: ["usage", "identity"],
    call: (providers) => {
      scanUsage(platform, { providers });
    },
    read: () => captured(sessions.scanUsage, 1)
  },
  {
    name: "readHookEvent",
    services: ["hooks"],
    call: (providers) => {
      readHookEvent("codex", {}, {}, { providers });
    },
    read: () => captured(events.readHookEvent, 3)
  },
  {
    name: "planInstall",
    services: ["install", "hooks"],
    call: (providers) => {
      planInstall(bundle, { agents: ["codex"], providers });
    },
    read: () => captured(harness.planInstall, 1)
  },
  {
    name: "findLegacy",
    services: ["install", "hooks"],
    call: (providers) => {
      findLegacy("test-app", { agents: ["codex"], legacyMarkers: ["test"], providers });
    },
    read: () => captured(harness.findLegacy, 1)
  },
  {
    name: "verify",
    services: ["install", "hooks"],
    call: (providers) => {
      verify("test-app", { providers });
    },
    read: () => captured(harness.verify, 1)
  },
  {
    name: "uninstall",
    services: ["install", "hooks"],
    call: (providers) => {
      uninstall("test-app", { providers });
    },
    read: () => captured(harness.uninstall, 1)
  },
  {
    name: "doctor",
    services: ["install", "hooks"],
    call: (providers) => {
      doctor({ providers });
    },
    read: () => captured(harness.doctor, 0)
  },
  {
    name: "connectAgent",
    services: ["acp"],
    call: (providers) => {
      connectAgent("codex", { cwd: "/work", env: {}, providers });
    },
    read: () => captured(acp.connectAgent, 1)
  },
  {
    name: "probeAgent",
    services: ["acp"],
    call: (providers) => {
      probeAgent("codex", { cwd: "/work", env: {}, providers });
    },
    read: () => captured(acp.probeAgent, 1)
  },
  {
    name: "hookDialectConformance",
    services: ["hooks"],
    call: (providers) => {
      hookDialectConformance(builtin.hooks!, { samples: [] }, { providers });
    },
    read: () => captured(testing.hookDialectConformance, 2, "hooks")
  },
  {
    name: "probeRecipeConformance",
    services: ["identity"],
    call: (providers) => {
      probeRecipeConformance(builtin.discovery!, {}, { providers });
    },
    read: () => captured(testing.probeRecipeConformance, 2, "identity")
  }
];

describe.each(bindings)("$name provider binding", (binding) => {
  it("merges by id and service and retains other agents", () => {
    binding.call([overrides]);
    const tables = binding.read();
    expect(Object.keys(tables).sort()).toEqual([...binding.services].sort());
    for (const service of binding.services) {
      expect(tables[service]?.[builtin.id]).toBe(overrides[service]);
      expect(tables[service]?.[other.id]).toBe(other[service]);
    }
  });

  it("replaces one service only, preserving all omitted services", () => {
    for (const service of binding.services) {
      binding.call([{ id: builtin.id, [service]: overrides[service] }]);
      const tables = binding.read();
      for (const needed of binding.services) {
        expect(tables[needed]?.[builtin.id]).toBe(needed === service ? overrides[needed] : builtin[needed]);
      }
    }
  });

  it("binds built-ins when no descriptors are supplied", () => {
    binding.call();
    for (const service of binding.services) {
      expect(binding.read()[service]?.[builtin.id]).toBe(builtin[service]);
    }
  });
});

it.each([
  { id: "mismatch", identity: builtin.identity },
  { id: "another", identity: { ...builtin.identity!, id: "another", aliases: [builtin.id] } },
  { id: "another", identity: { ...builtin.identity!, id: "another", aliases: ["claude"] } }
])("rejects ambiguous identity descriptors before calling a context", (provider) => {
  expect(() => listSessions(platform, { providers: [provider] })).toThrow(
    expect.objectContaining({ code: "invalid-identity-table" })
  );
  for (const binding of bindings.filter((candidate) => candidate.services.includes("install"))) {
    expect(() => binding.call([provider]), `${binding.name}`).toThrow(
      expect.objectContaining({ code: "invalid-identity-table" })
    );
  }
});

it("merges repeated descriptors and treats prototype names as own ids", () => {
  listSessions(platform, {
    providers: [
      { id: builtin.id, sessions: overrides.sessions },
      { id: builtin.id, identity: overrides.identity },
      { id: "__proto__", sessions: overrides.sessions }
    ]
  });
  const tables = captured(sessions.listSessions, 1);
  expect(tables.sessions?.[builtin.id]).toBe(overrides.sessions);
  expect(tables.identity?.[builtin.id]).toBe(overrides.identity);
  expect(Object.hasOwn(tables.sessions!, "__proto__")).toBe(true);
});

it("keeps the decoder table out of the published usage entry", async () => {
  const names = Object.keys(await import("../src/transcript/usage.js"));
  expect(names).toContain("scanUsage");
  expect(names).not.toContain("builtinUsageDecoders");
});
