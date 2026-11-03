import { builtinCodingAgents as testIdentity } from "./providers.js";
import { type ProbeRecipe, versionFromOutput } from "@rivus/agent-kit-discovery/public";
import { describe, expect, it } from "vite-plus/test";

import { probeRecipeConformance } from "../src/probe-recipe-conformance.js";

describe("probe recipe conformance catches", () => {
  const good: ProbeRecipe = {
    specificationVersion: "discovery-v1",
    agent: "my-agent",
    displayName: "My Agent",
    kind: "cli",
    commands: ["my-agent"],
    appPaths: [],
    configPaths: ["~/.my-agent"],
    mcpConfigPaths: [],
    version: { args: ["--version"], parse: versionFromOutput, sideEffects: [] },
    warnings: []
  };
  it("passes a well-formed third-party recipe", async () => {
    for (const { run } of probeRecipeConformance(good, {}, testIdentity)) {
      await expect(run()).resolves.toBeUndefined();
    }
  });
});
