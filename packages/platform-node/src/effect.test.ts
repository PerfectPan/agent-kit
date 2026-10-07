import { homedir } from "node:os";

import { describe, expect, it } from "@effect/vitest";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import { NodePlatformLive } from "./effect.js";

describe("NodePlatformLive", () => {
  it.effect("creates the platform when the Layer is built, not when the module loads", () => {
    process.env.AGENT_KIT_LAYER = "built";
    return Effect.gen(function* () {
      const platform = yield* PlatformService;
      expect(platform.env.AGENT_KIT_LAYER).toBe("built");
      expect(platform.home).toBe(homedir());
    }).pipe(Effect.provide(NodePlatformLive), Effect.ensuring(Effect.sync(() => delete process.env.AGENT_KIT_LAYER)));
  });
});
