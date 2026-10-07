import { describe, expect, it } from "vitest";

import { builtinHookDialects } from "../../agents/hook-dialects.js";
import { buildInstallPlan } from "../install-plan/factories/build-install-plan.js";
import { preferredStrategy } from "../install-plan/policies/strategy-preference.js";
import { Ledger } from "../ledger/aggregate/ledger.js";
import { isLegacyArtifact } from "./policies/legacy-markers.js";
import { placeHooks } from "./services/hook-placement.js";
import { hookRegistrations, runnersOf } from "./services/hook-registrations.js";
import type { HookSpec } from "./value-objects/artifact-spec.js";
import { type Bundle, checkBundle } from "./value-objects/bundle.js";

const bundle = (overrides: Partial<Bundle>): Bundle => ({
  owner: "agent-presence",
  version: "2.0.0",
  digest: "d",
  artifacts: [],
  ...overrides
});

describe("checkBundle", () => {
  it("accepts names that are safe as directory names and block ids", () => {
    const valid = bundle({
      owner: "@scope/app",
      artifacts: [
        { type: "skill", name: "presence-status", files: { "SKILL.md": "# x", "scripts/run.sh": "echo" } },
        { type: "mcp-server", name: "presence_mcp", transport: "stdio", command: "presence-mcp" },
        { type: "instructions", id: "presence", text: "Report status." },
        { type: "hooks", command: "/u/me/.local/bin/presence-hook", events: { codex: ["Stop"] }, timeoutSeconds: 5 }
      ]
    });
    expect(checkBundle(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([
    [{ owner: "Agent Presence" }, 'owner "Agent Presence" is not a package-style name'],
    [{ digest: "" }, "version and digest must not be empty"],
    [{ legacyMarkers: ["agent-presence hook", " "] }, "an empty legacy marker would match everything"],
    [
      { artifacts: [{ type: "skill", name: "x", files: { "SKILL.md": "", "../../.bashrc": "" } }] },
      'skill "x" has a file path that leaves its directory'
    ],
    [{ artifacts: [{ type: "skill", name: "x", files: { "README.md": "" } }] }, 'skill "x" has no SKILL.md'],
    [
      { artifacts: [{ type: "skill", name: "../x", files: { "SKILL.md": "" } }] },
      'skill name "../x" is not lowercase letters, digits and hyphens'
    ],
    [
      {
        artifacts: [
          { type: "instructions", id: "a", text: "" },
          { type: "instructions", id: "a", text: "" }
        ]
      },
      'duplicate instructions "a"'
    ],
    [
      {
        artifacts: [
          { type: "hooks", command: "x", events: {} },
          { type: "hooks", command: "y", events: {} }
        ]
      },
      "more than one hook spec"
    ],
    [
      { artifacts: [{ type: "hooks", command: "x", events: {}, timeoutSeconds: 0 }] },
      "hook timeout is not a positive number of seconds"
    ],
    [
      { artifacts: [{ type: "mcp-server", name: "2048", transport: "http", url: "http://localhost:2048" }] },
      'MCP server name "2048" does not start with a letter or "_" followed by letters, digits, "_" or "-"'
    ],
    [
      { artifacts: [{ type: "mcp-server", name: "-", transport: "stdio", command: "x" }] },
      'MCP server name "-" does not start with a letter or "_" followed by letters, digits, "_" or "-"'
    ]
  ] as const)("rejects %o", (overrides, reason) => {
    expect(checkBundle(bundle(overrides as Partial<Bundle>))).toEqual({
      ok: false,
      error: { _tag: "InvalidBundle", reason }
    });
  });
});

describe("isLegacyArtifact", () => {
  // The fingerprints by which earlier presence releases recognized their own hook commands and files.
  const markers = [
    "agent-presence hook",
    "@rivus/agent-presence",
    "agent-signature hook",
    "agent-signature.mjs hook",
    "dist/src/cli.js hook",
    "plugins/agent-presence.js",
    "plugins/agent-signature.js"
  ];

  it("recognizes a hook entry by its command, a plugin reference by its value and a generated file by its text", () => {
    expect(
      isLegacyArtifact(markers, {
        type: "command",
        command:
          "npx --yes @rivus/agent-presence@0.9.0 hook --source claude --event Stop --silent >/dev/null 2>/dev/null || true",
        timeout: 5000
      })
    ).toBe(true);
    expect(
      isLegacyArtifact(markers, { type: "command", command: "node /opt/x/dist/src/cli.js hook --event Stop" })
    ).toBe(true);
    expect(isLegacyArtifact(markers, "./plugins/agent-signature.js")).toBe(true);
    expect(isLegacyArtifact(markers, "// @rivus/agent-presence pi extension\nexport default () => {}")).toBe(true);
  });

  it("leaves the user's own hooks, other values and blank markers alone", () => {
    expect(isLegacyArtifact(markers, { type: "command", command: "~/bin/notify.sh" })).toBe(false);
    expect(isLegacyArtifact(markers, { hooks: [{ command: "agent-presence hook" }] })).toBe(false);
    expect(isLegacyArtifact(markers, ["agent-presence hook"])).toBe(false);
    expect(isLegacyArtifact(markers, undefined)).toBe(false);
    expect(isLegacyArtifact([""], "anything")).toBe(false);
  });
});

describe("hookRegistrations", () => {
  const spec = (events: HookSpec["events"], timeoutSeconds?: number): HookSpec => ({
    type: "hooks",
    command: "/u/me/.local/bin/presence-hook",
    events,
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds })
  });

  it("converts the timeout into each dialect's unit (agent-presence#85)", () => {
    expect(hookRegistrations(spec({ "claude-code": ["Stop"] }, 5), builtinHookDialects["claude-code"])).toEqual({
      ok: true,
      value: [{ event: "Stop", command: "/u/me/.local/bin/presence-hook", timeout: 5 }]
    });
    expect(hookRegistrations(spec({ "gemini-cli": ["AfterAgent"] }, 5), builtinHookDialects["gemini-cli"])).toEqual({
      ok: true,
      value: [{ event: "AfterAgent", command: "/u/me/.local/bin/presence-hook", timeout: 5000 }]
    });
    expect(hookRegistrations(spec({ "claude-code": ["Stop"] }), builtinHookDialects["claude-code"])).toEqual({
      ok: true,
      value: [{ event: "Stop", command: "/u/me/.local/bin/presence-hook" }]
    });
  });

  it("gives plugin-delivered agents no timeout and agents without events no registrations", () => {
    expect(hookRegistrations(spec({ opencode: ["session.idle"] }, 5), builtinHookDialects.opencode)).toEqual({
      ok: true,
      value: [{ event: "session.idle", command: "/u/me/.local/bin/presence-hook" }]
    });
    expect(hookRegistrations(spec({ codex: ["Stop"] }), builtinHookDialects.grok)).toEqual({ ok: true, value: [] });
  });

  it("refuses an event the dialect does not know, such as Gemini's old Claude-style names (agent-presence#86)", () => {
    expect(hookRegistrations(spec({ "gemini-cli": ["PreToolUse"] }), builtinHookDialects["gemini-cli"])).toEqual({
      ok: false,
      error: { _tag: "HookSpecRejected", agent: "gemini-cli", event: "PreToolUse", reason: "unknown-event" }
    });
    expect(hookRegistrations(spec({ codex: ["constructor"] }), builtinHookDialects.codex)).toMatchObject({
      ok: false,
      error: { reason: "unknown-event" }
    });
  });

  it("never registers an observer on a gate where silence does not let the operation proceed", () => {
    expect(hookRegistrations(spec({ cursor: ["postToolUse", "preToolUse"] }), builtinHookDialects.cursor)).toEqual({
      ok: false,
      error: { _tag: "HookSpecRejected", agent: "cursor", event: "preToolUse", reason: "blocking-gate" }
    });
    expect(
      hookRegistrations(spec({ "claude-code": ["PreToolUse"] }), builtinHookDialects["claude-code"])
    ).toMatchObject({
      ok: true
    });
  });
});

describe("hookRegistrations across agents that run each other's hooks", () => {
  const spec: HookSpec = {
    type: "hooks",
    command: "/u/me/.local/bin/presence-hook",
    events: { "claude-code": ["Stop", "PreToolUse"] }
  };

  it("finds the agents that load a file's hooks", () => {
    expect(runnersOf("claude-code", "~/.claude/settings.json", builtinHookDialects).map((d) => d.agent)).toEqual([
      "cursor",
      "grok"
    ]);
    expect(runnersOf("claude-code", "~/.claude/skills/presence/hooks/hooks.json", builtinHookDialects)).toEqual([]);
  });

  it("refuses Claude Code's PreToolUse in its settings file, which Cursor runs as its preToolUse gate (agent-presence#89)", () => {
    const runBy = runnersOf("claude-code", "~/.claude/settings.json", builtinHookDialects);
    expect(hookRegistrations(spec, builtinHookDialects["claude-code"], { runBy })).toEqual({
      ok: false,
      error: {
        _tag: "HookSpecRejected",
        agent: "claude-code",
        event: "PreToolUse",
        reason: "blocking-gate",
        runBy: { agent: "cursor", event: "preToolUse" }
      }
    });
    expect(
      hookRegistrations({ ...spec, events: { "claude-code": ["Stop"] } }, builtinHookDialects["claude-code"], { runBy })
    ).toMatchObject({ ok: true, value: [{ event: "Stop" }] });
  });

  it("allows it where no other agent loads it, such as a skills-dir plugin", () => {
    const runBy = runnersOf("claude-code", "~/.claude/skills/presence/hooks/hooks.json", builtinHookDialects);
    expect(hookRegistrations(spec, builtinHookDialects["claude-code"], { runBy })).toMatchObject({ ok: true });
  });
});

describe("placeHooks", () => {
  const command = "/u/me/.local/bin/presence-hook";
  const settings = { agent: "claude-code", file: "~/.claude/settings.json" } as const;
  const plugin = { agent: "claude-code", file: "~/.claude/skills/presence/hooks/hooks.json" } as const;
  const grok = { agent: "grok", file: "~/.grok/hooks/presence.json" } as const;
  const cursor = { agent: "cursor", file: "~/.cursor/hooks.json" } as const;
  const spec = (events: HookSpec["events"]): HookSpec => ({ type: "hooks", command, events });

  it("registers Stop once when Grok runs Claude Code's settings file: Grok relies on Claude Code's registration", () => {
    expect(
      placeHooks(spec({ "claude-code": ["Stop"], grok: ["Stop"] }), [settings, grok], builtinHookDialects)
    ).toEqual({
      ok: true,
      value: [
        { ...settings, registrations: [{ event: "Stop", command, agents: ["claude-code", "grok"] }] },
        { ...grok, registrations: [] }
      ]
    });
  });

  it("registers both when Claude Code's hooks go into a skills-dir plugin, which Grok does not run", () => {
    expect(placeHooks(spec({ "claude-code": ["Stop"], grok: ["Stop"] }), [grok, plugin], builtinHookDialects)).toEqual({
      ok: true,
      value: [
        { ...grok, registrations: [{ event: "Stop", command, agents: ["grok"] }] },
        { ...plugin, registrations: [{ event: "Stop", command, agents: ["claude-code"] }] }
      ]
    });
  });

  it("settles a chain: Cursor runs Claude Code's file, Grok runs both", () => {
    const placed = placeHooks(
      spec({ "claude-code": ["Stop"], cursor: ["stop"], grok: ["Stop"] }),
      [grok, cursor, settings],
      builtinHookDialects
    );
    expect(placed.ok && placed.value.map((placement) => [placement.agent, placement.registrations])).toEqual([
      ["grok", []],
      ["cursor", []],
      ["claude-code", [{ event: "Stop", command, agents: ["claude-code", "cursor", "grok"] }]]
    ]);
  });

  it("reports an event that would still fire twice, from two files the agent runs", () => {
    expect(
      placeHooks(
        spec({ "claude-code": ["PostToolUse"], cursor: ["afterFileEdit"], grok: ["PostToolUse"] }),
        [settings, cursor, grok],
        builtinHookDialects
      )
    ).toEqual({
      ok: false,
      error: {
        _tag: "HookOverlap",
        agent: "grok",
        event: "PostToolUse",
        sources: [
          { agent: "claude-code", event: "PostToolUse" },
          { agent: "cursor", event: "afterFileEdit" }
        ]
      }
    });
  });

  it("reports an event that would fire twice in an agent that is not placed but runs the placed files (Grok)", () => {
    const input = spec({ "claude-code": ["PostToolUse"], cursor: ["afterFileEdit"] });
    expect(placeHooks(input, [settings, cursor], builtinHookDialects)).toEqual({
      ok: false,
      error: {
        _tag: "HookOverlap",
        agent: "grok",
        event: "PostToolUse",
        sources: [
          { agent: "claude-code", event: "PostToolUse" },
          { agent: "cursor", event: "afterFileEdit" }
        ]
      }
    });
    const cursorHooksOff = [{ runner: "grok", agent: "cursor", enabled: false }] as const;
    expect(placeHooks(input, [settings, cursor], builtinHookDialects, { compat: cursorHooksOff })).toMatchObject({
      ok: true
    });
  });

  it("checks the gates of every agent that could run the file, even one reported as turned off (agent-presence#89)", () => {
    const cursorOff = [{ runner: "cursor", agent: "claude-code", enabled: false }] as const;
    expect(
      placeHooks(spec({ "claude-code": ["PreToolUse"] }), [settings], builtinHookDialects, { compat: cursorOff })
    ).toMatchObject({ ok: false, error: { reason: "blocking-gate", runBy: { agent: "cursor", event: "preToolUse" } } });
    const optIn = {
      ...builtinHookDialects.cursor,
      agent: "opt-in",
      runsHooksOf: builtinHookDialects.cursor.runsHooksOf?.map((hooks) => ({ ...hooks, byDefault: false }))
    };
    expect(runnersOf("claude-code", "~/.claude/settings.json", { "opt-in": optIn }).map((d) => d.agent)).toEqual([
      "opt-in"
    ]);
  });

  it("keeps an agent's own registrations when its loading of another agent's hooks is turned off", () => {
    const claudeHooksOff = [{ runner: "grok", agent: "claude-code", enabled: false }] as const;
    const placed = placeHooks(
      spec({ "claude-code": ["Stop"], grok: ["Stop"] }),
      [settings, grok],
      builtinHookDialects,
      {
        compat: claudeHooksOff
      }
    );
    expect(placed.ok && placed.value.map((placement) => placement.registrations)).toEqual([
      [{ event: "Stop", command, agents: ["claude-code"] }],
      [{ event: "Stop", command, agents: ["grok"] }]
    ]);
  });

  it.each([
    [[settings, plugin], { agent: "claude-code", file: plugin.file, reason: "repeated-agent" }],
    [
      [{ agent: "claude-code", file: "/u/me/.claude/settings.json" }, grok],
      { agent: "claude-code", file: "/u/me/.claude/settings.json", reason: "not-home-or-project-relative" }
    ],
    [
      [{ agent: "grok", file: "~/../etc/hooks.json" }],
      { agent: "grok", file: "~/../etc/hooks.json", reason: "not-home-or-project-relative" }
    ],
    [
      [{ agent: "grok", file: "C:\\hooks.json" }],
      { agent: "grok", file: "C:\\hooks.json", reason: "not-home-or-project-relative" }
    ]
  ] as const)("refuses placements it cannot judge: %o", (placements, error) => {
    expect(placeHooks(spec({ "claude-code": ["Stop"], grok: ["Stop"] }), placements, builtinHookDialects)).toEqual({
      ok: false,
      error: { _tag: "InvalidHookPlacement", ...error }
    });
  });

  it("records the agents that rely on a registration in the plan, so uninstalling one of them releases it", () => {
    const placed = placeHooks(spec({ "claude-code": ["Stop"], grok: ["Stop"] }), [settings, grok], builtinHookDialects);
    const [claude] = placed.ok ? placed.value : [];
    const locator = {
      kind: "json-entry",
      path: "/u/me/.claude/settings.json",
      pointer: "/hooks/Stop",
      member: command
    } as const;
    const hash = `sha256:${"1".repeat(64)}` as const;
    const desired = (claude?.registrations ?? []).flatMap((registration) =>
      registration.agents.map((agent) => ({
        agent,
        locator,
        content: { command },
        hash,
        strategy: "shared-config" as const
      }))
    );
    const ledger = Ledger.create("lineage-1");
    const built =
      ledger.ok &&
      buildInstallPlan(
        {
          planId: "plan-1",
          bundle: bundle({}),
          target: { scope: "user", agents: ["claude-code", "grok"], roots: ["/u/me/.claude"] },
          desired
        },
        ledger.value,
        []
      );
    expect(built && built.ok && built.value.steps).toEqual([
      expect.objectContaining({ locator, action: "create", agents: ["claude-code", "grok"] })
    ]);
  });
});

describe("preferredStrategy", () => {
  it("prefers launch injection, then a native plugin, a scanned directory, and shared configuration last", () => {
    const all = ["shared-config", "scan-directory", "native-plugin", "launch-injection"] as const;
    expect(preferredStrategy(all, { launching: true })).toBe("launch-injection");
    expect(preferredStrategy(all, { launching: false })).toBe("native-plugin");
    expect(preferredStrategy(["shared-config", "scan-directory"], { launching: false })).toBe("scan-directory");
    expect(preferredStrategy(["shared-config"], { launching: false })).toBe("shared-config");
    expect(preferredStrategy(["launch-injection"], { launching: false })).toBeUndefined();
  });
});
