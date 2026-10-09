import { describe, expect, it } from "vite-plus/test";

import type { InstallAdapter } from "../../bundle/value-objects/install-adapter.js";
import type { HookSpec } from "../../bundle/value-objects/artifact-spec.js";
import { chooseStrategy, requiredCommands, strategyRequirement, strategyUnsupported } from "./strategy-choice.js";

const adapter = (overrides: Partial<InstallAdapter> = {}): InstallAdapter => ({
  specificationVersion: "harness-v1",
  agent: "codex",
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  requires: { "native-plugin": "codex" },
  roots: () => ["/u/me/.codex"],
  hookFile: () => "~/.codex/config.toml",
  renderHooks: () => [],
  renderSkill: () => [],
  ...overrides
});

const hooks = (events: Readonly<Record<string, readonly string[]>> = {}): HookSpec => ({
  type: "hooks",
  command: "/u/me/hook",
  events
});

describe("strategyRequirement", () => {
  it("skips a hook spec naming none of the agent's events, needs hooks otherwise, and always needs skills", () => {
    expect(strategyRequirement(hooks({ "claude-code": ["Stop"] }), "codex")).toBe("skip");
    expect(strategyRequirement(hooks({ codex: ["Stop"] }), "codex")).toBe("hooks");
    expect(strategyRequirement({ type: "skill", name: "s", files: { "SKILL.md": "" } }, "codex")).toBe("skill");
  });

  it("has no built-in strategy for mcp servers or instructions", () => {
    expect(strategyRequirement({ type: "instructions", id: "x", text: "y" }, "codex")).toBe("unsupported");
    expect(
      strategyUnsupported("codex", {
        type: "mcp-server",
        name: "x",
        transport: "stdio",
        command: "x"
      })
    ).toEqual({
      _tag: "StrategyUnavailable",
      agent: "codex",
      artifact: "mcp-server",
      missing: []
    });
  });
});

describe("chooseStrategy", () => {
  it("takes the adapter's first supported strategy in its declared order", () => {
    expect(chooseStrategy(adapter(), "hooks", { available: new Set(["codex"]) })).toEqual({
      ok: true,
      value: "native-plugin"
    });
    expect(chooseStrategy(adapter(), "hooks", { available: new Set() })).toEqual({
      ok: true,
      value: "shared-config"
    });
  });

  it("falls to the next strategy when the first needs a missing executable, naming what was missing", () => {
    expect(
      chooseStrategy(adapter({ hookStrategies: ["native-plugin"] }), "hooks", {
        available: new Set()
      })
    ).toEqual({
      ok: false,
      error: {
        _tag: "StrategyUnavailable",
        agent: "codex",
        artifact: "hooks",
        missing: [{ strategy: "native-plugin", command: "codex" }]
      }
    });
  });

  it("only accepts an override the adapter declares", () => {
    expect(chooseStrategy(adapter(), "hooks", { override: "launch-injection", available: new Set() })).toMatchObject({
      ok: false,
      error: { _tag: "StrategyUnavailable", missing: [] }
    });
    expect(chooseStrategy(adapter(), "hooks", { override: "shared-config", available: new Set() })).toEqual({
      ok: true,
      value: "shared-config"
    });
  });

  it("probes skills separately from hooks", () => {
    expect(chooseStrategy(adapter(), "skill", { available: new Set() })).toEqual({
      ok: true,
      value: "scan-directory"
    });
  });

  it("lists the union of required commands across both artifact kinds", () => {
    expect(
      requiredCommands(
        adapter({
          requires: { "native-plugin": "codex", "scan-directory": "find" }
        })
      )
    ).toEqual(["codex", "find"]);
  });
});
