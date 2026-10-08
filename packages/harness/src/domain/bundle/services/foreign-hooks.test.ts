import { describe, expect, it } from "vitest";

import { builtinHookDialects } from "../../adapters/hook-dialects.js";
import { builtinInstallAdapters } from "../../adapters/install-adapters.js";
import { droppedHooksOf, placeHooks } from "./hook-placement.js";
import { foreignHookFiles } from "./hook-registrations.js";
import type { HookSpec } from "../value-objects/artifact-spec.js";
import type { InstallContext } from "../value-objects/install-adapter.js";

const context: InstallContext = { home: "/u/me", env: {} };

const hookSpec: HookSpec = {
  type: "hooks",
  command: "/u/me/.local/bin/presence-hook",
  events: { "claude-code": ["Stop"], grok: ["Stop"] }
};

describe("foreignHookFiles", () => {
  it("names every other agent's ~/ file the runner actually loads, with its owner, shape and renames", () => {
    const files = foreignHookFiles("grok", builtinHookDialects, builtinInstallAdapters, context);
    const settings = files.find((file) => file.path === "/u/me/.claude/settings.json");
    expect(settings).toEqual({
      owner: "claude-code",
      path: "/u/me/.claude/settings.json",
      source: expect.objectContaining({ format: "json", layout: "grouped" }),
      rename: expect.objectContaining({ Stop: "Stop" })
    });
  });

  it("falls back to the owner's first known source for a file its current adapter no longer names", () => {
    const local = files0();
    expect(local.find((file) => file.path === "/u/me/.claude/settings.local.json")?.source).toEqual(
      expect.objectContaining({ format: "json", layout: "grouped" })
    );
  });

  it("skips a file the runner turned off through a compat reading, and files outside ~/", () => {
    const files = foreignHookFiles("grok", builtinHookDialects, builtinInstallAdapters, context, [
      { runner: "grok", agent: "claude-code", enabled: false }
    ]);
    expect(files.some((file) => file.owner === "claude-code")).toBe(false);
  });

  function files0() {
    return foreignHookFiles("grok", builtinHookDialects, builtinInstallAdapters, context);
  }
});

describe("droppedHooksOf", () => {
  it("is the list of agents whose own registration another placed file fires", () => {
    const placed = placeHooks(
      hookSpec,
      [
        { agent: "claude-code", file: "~/.claude/settings.json" },
        { agent: "grok", file: "~/.grok/hooks/presence.json" }
      ],
      builtinHookDialects,
      {}
    );
    if (!placed.ok) {
      throw new Error(JSON.stringify(placed.error));
    }
    const dropped = droppedHooksOf(placed.value);
    const stop = dropped.filter((hook) => hook.firedBy.event === "Stop");
    expect(stop).toEqual([
      { agent: "grok", firedBy: { agent: "claude-code", event: "Stop", file: "~/.claude/settings.json" } }
    ]);
  });
});
