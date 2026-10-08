import { describe, expect, it } from "vitest";

import { builtinProbeRecipes } from "./index.js";

describe("builtinProbeRecipes", () => {
  it("keys every recipe by its own agent id", () => {
    for (const [agent, recipe] of Object.entries(builtinProbeRecipes)) {
      expect(recipe.agent).toBe(agent);
    }
  });
});
