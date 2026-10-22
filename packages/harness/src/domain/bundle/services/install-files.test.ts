import { describe, expect, it } from "vite-plus/test";

import {
  agentsOf,
  commandHook,
  configHome,
  groupedHooksFile,
  sharedAgentsDir,
  sharedSkillsDir
} from "./install-files.js";
import { jsonText } from "../../../lib/json.js";

const context = { home: "/u/example", env: {} };

describe("shared install file rendering", () => {
  it("writes readable JSON with a final newline and preserves hook command timeouts", () => {
    expect(jsonText({ command: "example hook" })).toBe('{\n  "command": "example hook"\n}\n');
    expect(commandHook({ event: "Stop", command: "example hook" })).toEqual({
      type: "command",
      command: "example hook"
    });
    expect(commandHook({ event: "Stop", command: "example hook", timeout: 10 })).toEqual({
      type: "command",
      command: "example hook",
      timeout: 10
    });
    expect(
      groupedHooksFile([
        { event: "Stop", command: "first" },
        { event: "Start", command: "start" },
        { event: "Stop", command: "second", timeout: 5 }
      ])
    ).toEqual({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "first" }] },
          { hooks: [{ type: "command", command: "second", timeout: 5 }] }
        ],
        Start: [{ hooks: [{ type: "command", command: "start" }] }]
      }
    });
  });

  it("uses the shared home directories and only an absolute XDG configuration root", () => {
    expect(sharedAgentsDir(context)).toBe("/u/example/.agents");
    expect(sharedSkillsDir(context)).toBe("/u/example/.agents/skills");
    expect(configHome(context)).toBe("/u/example/.config");
    expect(configHome({ ...context, env: { XDG_CONFIG_HOME: "relative" } })).toBe("/u/example/.config");
    expect(configHome({ ...context, env: { XDG_CONFIG_HOME: "/config///" } })).toBe("/config");
  });

  it("records all consumers of shared hooks once in stable order", () => {
    expect(
      agentsOf([
        { event: "Stop", command: "first", agents: ["beta", "alpha"] },
        { event: "Start", command: "second", agents: ["alpha", "gamma"] }
      ])
    ).toEqual(["alpha", "beta", "gamma"]);
  });
});
