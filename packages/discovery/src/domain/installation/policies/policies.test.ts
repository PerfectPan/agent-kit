import { describe, expect, it } from "vite-plus/test";

import { appBundleMatches } from "./app-bundle.js";
import { installationWarnings } from "./installation-warnings.js";
import type { ProbeProblem } from "../value-objects/probe-problem.js";
import type { ProbeRecipe } from "../value-objects/probe-recipe.js";

const recipe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "my-agent",
  displayName: "My Agent",
  kind: "cli",
  commands: ["my-agent"],
  appPaths: [],
  configPaths: [],
  mcpConfigPaths: [],
  warnings: ["recipe caveat"]
};

const shim: ProbeProblem = {
  _tag: "CommandFailed",
  purpose: "version",
  path: "/c/my-agent.cmd",
  args: ["--version"],
  reason: "shell-shim-not-run"
};

describe("installationWarnings", () => {
  it("adds the shim caveat to the recipe's own warnings, once", () => {
    expect(installationWarnings(recipe, [shim])).toEqual([
      "recipe caveat",
      "The command is a Windows .cmd or .bat shim, which runs only through a shell; detection does not run it, so the agent is at most found."
    ]);
    expect(installationWarnings(recipe, [])).toEqual(["recipe caveat"]);
    expect(installationWarnings(recipe, [{ ...shim, reason: "timed-out" }])).toEqual(["recipe caveat"]);
  });
});

describe("appBundleMatches", () => {
  it("rejects a bundle whose XML plist names another id, and accepts one whose id cannot be read", () => {
    expect(appBundleMatches("com.other.app", ["com.mine.app"])).toBe(false);
    expect(appBundleMatches("com.mine.app", ["com.mine.app", "com.other.app"])).toBe(true);
    expect(appBundleMatches(undefined, ["com.mine.app"])).toBe(true);
  });
});
