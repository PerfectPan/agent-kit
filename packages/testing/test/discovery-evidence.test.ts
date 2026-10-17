import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { detectAgents } from "@rivus/agent-kit-discovery";
import {
  applyInstall,
  type Bundle,
  ChezmoiExternalOwnerLive,
  FileLedgerRepositoryLive,
  LedgerLock,
  planInstall,
  PlatformArtifactFilesLive,
  ProcessAgentCliLive
} from "@rivus/agent-kit-harness/public";
import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it, vi } from "vite-plus/test";

import { createMemoryPlatform, type MemoryPlatformOptions } from "../src/memory-platform.js";

const HOME = "/u/me";
const NOW = 1_700_000_000_000;

interface AgentPaths {
  readonly agent: CodingAgentId;
  readonly home: string;
  readonly override: Readonly<Record<string, string>>;
  readonly overrideHome: string;
  readonly store: string;
  readonly evidence: readonly { readonly path: string; readonly kind: "dir" | "file" }[];
  readonly installedHook: string;
}

const AGENTS: readonly AgentPaths[] = [
  {
    agent: "claude-code",
    home: `${HOME}/.claude`,
    override: { CLAUDE_CONFIG_DIR: "/cfg/claude" },
    overrideHome: "/cfg/claude",
    store: "projects",
    evidence: [
      { path: "projects", kind: "dir" },
      { path: ".credentials.json", kind: "file" }
    ],
    installedHook: ".claude/skills/discovery-app/hooks/hooks.json"
  },
  {
    agent: "codex",
    home: `${HOME}/.codex`,
    override: { CODEX_HOME: "/cfg/codex" },
    overrideHome: "/cfg/codex",
    store: "sessions",
    evidence: [
      { path: "sessions", kind: "dir" },
      { path: "archived_sessions", kind: "dir" },
      { path: "auth.json", kind: "file" }
    ],
    installedHook: ".codex/config.toml"
  },
  {
    agent: "gemini-cli",
    home: `${HOME}/.gemini`,
    override: { GEMINI_CLI_HOME: "/cfg/gemini" },
    overrideHome: "/cfg/gemini/.gemini",
    store: "tmp",
    evidence: [
      { path: "tmp", kind: "dir" },
      { path: "oauth_creds.json", kind: "file" }
    ],
    installedHook: ".gemini/extensions/discovery-app/hooks/hooks.json"
  },
  {
    agent: "grok",
    home: `${HOME}/.grok`,
    override: { GROK_HOME: "/cfg/grok" },
    overrideHome: "/cfg/grok",
    store: "sessions",
    evidence: [
      { path: "sessions", kind: "dir" },
      { path: "auth.json", kind: "file" }
    ],
    installedHook: ".grok/hooks/discovery-app.json"
  },
  {
    agent: "opencode",
    home: `${HOME}/.local/share/opencode`,
    override: { XDG_DATA_HOME: "/data" },
    overrideHome: "/data/opencode",
    store: "storage/message",
    evidence: [
      { path: "opencode.db", kind: "file" },
      { path: "storage/message", kind: "dir" },
      { path: "auth.json", kind: "file" }
    ],
    installedHook: ".config/opencode/plugins/discovery-app.js"
  },
  {
    agent: "pi",
    home: `${HOME}/.pi/agent`,
    override: { PI_CODING_AGENT_DIR: "~/custom-pi" },
    overrideHome: `${HOME}/custom-pi`,
    store: "sessions",
    evidence: [{ path: "sessions", kind: "dir" }],
    installedHook: ".pi/agent/extensions/discovery-app.ts"
  }
];

const EVIDENCE = AGENTS.flatMap((agent) => agent.evidence.map((evidence) => ({ ...agent, ...evidence })));

const INSTALL_TARGETS: readonly { readonly agent: CodingAgentId; readonly installedHook: string }[] = [
  ...AGENTS,
  { agent: "cursor", installedHook: ".cursor/plugins/local/discovery-app/hooks/hooks.json" }
];

const BUNDLE: Bundle = {
  owner: "discovery-app",
  version: "1.0.0",
  digest: "discovery-bundle",
  artifacts: [
    {
      type: "hooks",
      command: "/opt/example/bin/hook --agent {agent}",
      events: {
        "claude-code": ["SessionStart"],
        codex: ["SessionStart"],
        "gemini-cli": ["SessionStart"],
        grok: ["SessionStart"],
        opencode: ["session.created"],
        pi: ["session_start"],
        cursor: ["sessionStart"]
      }
    },
    { type: "skill", name: "example-skill", files: { "SKILL.md": "---\nname: example-skill\n---\nExample\n" } }
  ]
};

function machine(options: MemoryPlatformOptions = {}) {
  const memory = createMemoryPlatform({
    ...options,
    home: HOME,
    env: { HOME, PATH: "", ...options.env },
    now: () => NOW
  });
  return {
    ...memory,
    clock: { now: () => NOW, monotonic: () => 0 },
    process: {
      run: vi.fn<Platform["process"]["run"]>(() => Promise.reject(new Error("no process should run"))),
      spawn: vi.fn<Platform["process"]["spawn"]>(() => {
        throw new Error("no process should spawn");
      }),
      self: { host: "test-host", bootId: "test-boot", pid: 1, startTime: 0 },
      identify: vi.fn<Platform["process"]["identify"]>(() => undefined)
    }
  } satisfies Platform;
}

async function seed(platform: Platform, path: string, kind: "dir" | "file"): Promise<void> {
  if (kind === "dir") {
    await platform.fs.mkdir(path);
  } else {
    await platform.fs.writeAtomic(path, "{}");
  }
}

function harnessLayer(platform: Platform) {
  return Layer.mergeAll(
    PlatformArtifactFilesLive,
    FileLedgerRepositoryLive,
    ProcessAgentCliLive,
    ChezmoiExternalOwnerLive,
    Layer.succeed(LedgerLock, { acquire: () => Effect.void, holder: () => Effect.succeed(undefined) })
  ).pipe(Layer.provideMerge(Layer.succeed(PlatformService, platform)));
}

async function installerOnlyMachine(): Promise<ReturnType<typeof machine>> {
  const platform = machine();
  await platform.fs.mkdir(HOME);
  await Effect.runPromise(
    Effect.gen(function* () {
      const plan = yield* planInstall(BUNDLE, { agents: INSTALL_TARGETS.map(({ agent }) => agent) });
      const applied = yield* applyInstall(plan);
      expect(plan.status).toBe("applied");
      expect(applied.steps.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(harnessLayer(platform)))
  );
  for (const { installedHook } of INSTALL_TARGETS) {
    expect(await platform.fs.stat(`${HOME}/${installedHook}`)).toMatchObject({ kind: "file" });
  }
  expect(platform.process.run).not.toHaveBeenCalled();
  expect(platform.process.spawn).not.toHaveBeenCalled();
  return platform;
}

const SHARED_PATHS: readonly { readonly agent: CodingAgentId; readonly paths: readonly string[] }[] = [
  {
    agent: "claude-code",
    paths: [
      ".claude",
      ".claude.json",
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/skills/example/SKILL.md",
      ".claude/plugins/example/plugin.json"
    ]
  },
  {
    agent: "codex",
    paths: [
      ".codex",
      ".codex/config.toml",
      ".codex/hooks.json",
      ".codex/plugins/example/hooks/hooks.json",
      ".agents/skills/example/SKILL.md"
    ]
  },
  {
    agent: "gemini-cli",
    paths: [".gemini", ".gemini/settings.json", ".gemini/extensions/example/gemini-extension.json"]
  },
  {
    agent: "grok",
    paths: [".grok", ".grok/config.toml", ".grok/hooks/example.json", ".grok/plugins/example/plugin.json"]
  },
  {
    agent: "opencode",
    paths: [
      ".local/share/opencode",
      ".config/opencode",
      ".config/opencode/opencode.json",
      ".config/opencode/opencode.jsonc",
      ".config/opencode/plugins/example.js",
      ".config/opencode/plugin/example.js"
    ]
  },
  {
    agent: "pi",
    paths: [
      ".pi/agent",
      ".pi/agent/settings.json",
      ".pi/agent/extensions/example.ts",
      ".pi/agent/skills/example/SKILL.md"
    ]
  },
  {
    agent: "cursor",
    paths: [
      ".cursor",
      ".cursor/hooks.json",
      ".cursor/mcp.json",
      ".cursor/plugins/local/example/hooks/hooks.json",
      ".config/cursor",
      "Library/Application Support/Cursor/User/mcp.json",
      ".config/Cursor/User/mcp.json",
      "AppData/Roaming/Cursor/User/mcp.json"
    ]
  }
];

describe("agent-owned discovery evidence", () => {
  it("S117: reports every agent missing with only default bundle artifacts installed for all seven agents and an empty PATH", async () => {
    const platform = await installerOnlyMachine();
    const installations = await detectAgents(platform, { versionProbe: false });
    expect(
      installations.map(({ agent, status, evidence, problems }) => ({ agent, status, evidence, problems }))
    ).toEqual(installations.map(({ agent }) => ({ agent, status: "missing", evidence: [], problems: [] })));
    expect(platform.process.run).not.toHaveBeenCalled();
  });

  it("refuses Codex's forced native-plugin strategy when its CLI is absent from PATH", async () => {
    const platform = machine();
    await platform.fs.mkdir(HOME);
    const failure = await Effect.runPromise(
      Effect.flip(planInstall(BUNDLE, { agents: ["codex"], strategies: { codex: { hooks: "native-plugin" } } })).pipe(
        Effect.provide(harnessLayer(platform))
      )
    );
    expect(failure).toEqual({
      _tag: "StrategyUnavailable",
      agent: "codex",
      artifact: "hooks",
      missing: [{ strategy: "native-plugin", command: "codex" }]
    });
    expect(platform.process.run).not.toHaveBeenCalled();
    expect(platform.process.spawn).not.toHaveBeenCalled();
  });

  it.each(AGENTS)(
    "finds only $agent when its store is added to the installed bundle artifacts",
    async ({ agent, home, store }) => {
      const platform = await installerOnlyMachine();
      await platform.fs.mkdir(`${home}/${store}`);
      const installations = await detectAgents(platform, { versionProbe: false });
      expect(installations.map((installation) => [installation.agent, installation.status])).toEqual(
        installations.map((installation) => [installation.agent, installation.agent === agent ? "found" : "missing"])
      );
      expect(installations.find((installation) => installation.agent === agent)?.evidence).toEqual([
        { kind: "config", path: `${home}/${store}` }
      ]);
      expect(platform.process.run).not.toHaveBeenCalled();
    }
  );

  it.each(EVIDENCE)("counts $agent $path as configuration evidence", async ({ agent, home, path, kind }) => {
    const platform = machine();
    await seed(platform, `${home}/${path}`, kind);
    const [installation] = await detectAgents(platform, { agents: [agent], versionProbe: false });
    expect(installation).toMatchObject({
      status: "found",
      evidence: [{ kind: "config", path: `${home}/${path}` }],
      problems: []
    });
    expect(platform.process.run).not.toHaveBeenCalled();
  });

  it.each(EVIDENCE)(
    "follows the home override for $agent $path",
    async ({ agent, override, overrideHome, path, kind }) => {
      const platform = machine({ env: override });
      await seed(platform, `${overrideHome}/${path}`, kind);
      const [installation] = await detectAgents(platform, { agents: [agent], versionProbe: false });
      expect(installation).toMatchObject({
        status: "found",
        evidence: [{ kind: "config", path: `${overrideHome}/${path}` }],
        problems: []
      });
    }
  );

  it.each(EVIDENCE)(
    "ignores the default home for $agent $path when its override is set",
    async ({ agent, home, override, path, kind }) => {
      const platform = machine({ env: override });
      await seed(platform, `${home}/${path}`, kind);
      const [installation] = await detectAgents(platform, { agents: [agent], versionProbe: false });
      expect(installation).toMatchObject({ status: "missing", evidence: [], problems: [] });
    }
  );

  it.each([".config/cursor/auth.json", "AppData/Roaming/Cursor/auth.json"])(
    "counts Cursor's credential file %s",
    async (path) => {
      const platform = machine({ files: { [`${HOME}/${path}`]: "{}" } });
      const [installation] = await detectAgents(platform, { agents: ["cursor"], versionProbe: false });
      expect(installation).toMatchObject({
        status: "found",
        evidence: [{ kind: "config", path: `${HOME}/${path}` }],
        problems: []
      });
    }
  );

  it.each([
    "Library/Application Support/Cursor/User/globalStorage",
    ".config/Cursor/User/globalStorage",
    "AppData/Roaming/Cursor/User/globalStorage"
  ])("finds only Cursor with desktop user data at %s and no command or application", async (path) => {
    const platform = machine();
    await platform.fs.mkdir(`${HOME}/${path}`);
    const installations = await detectAgents(platform, { versionProbe: false });
    expect(installations.map((installation) => [installation.agent, installation.status])).toEqual(
      installations.map((installation) => [installation.agent, installation.agent === "cursor" ? "found" : "missing"])
    );
    const cursor = installations.find((installation) => installation.agent === "cursor");
    expect(cursor).toMatchObject({
      status: "found",
      evidence: [{ kind: "config", path: `${HOME}/${path}` }],
      problems: []
    });
    expect(cursor?.command).toBeUndefined();
    expect(cursor?.appPath).toBeUndefined();
    expect(platform.process.run).not.toHaveBeenCalled();
    expect(platform.process.spawn).not.toHaveBeenCalled();
  });

  it.each(SHARED_PATHS.flatMap(({ agent, paths }) => paths.map((path) => ({ agent, path }))))(
    "ignores installer-writable $agent path $path",
    async ({ agent, path }) => {
      const platform = machine();
      await seed(platform, `${HOME}/${path}`, /\.(?:jsonc?|toml|md|js|ts)$/.test(path) ? "file" : "dir");
      const [installation] = await detectAgents(platform, { agents: [agent], versionProbe: false });
      expect(installation).toMatchObject({ status: "missing", evidence: [], problems: [] });
    }
  );
});
