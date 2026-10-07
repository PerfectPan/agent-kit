import { homedir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createNodePlatform } from "./create-node-platform.js";

describe("createNodePlatform", () => {
  afterEach(() => {
    delete process.env.AGENT_KIT_SNAPSHOT;
  });

  it("defaults env to a frozen snapshot of process.env and home to the OS home directory", () => {
    process.env.AGENT_KIT_SNAPSHOT = "before";
    const platform = createNodePlatform();
    process.env.AGENT_KIT_SNAPSHOT = "after";

    expect(platform.env.AGENT_KIT_SNAPSHOT).toBe("before");
    expect(Object.isFrozen(platform.env)).toBe(true);
    expect(platform.home).toBe(homedir());
    expect(platform.os).toBe(process.platform);
  });

  it("S23: uses the injected env and home", () => {
    const env = { CODEX_HOME: "/tmp/codex-home" };
    const platform = createNodePlatform({ env, home: "/tmp/home" });
    expect(platform.env).toBe(env);
    expect(platform.home).toBe("/tmp/home");
  });

  it("has a wall clock and a monotonic clock", () => {
    const { clock } = createNodePlatform({ env: {}, home: "/u/me" });
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
    const first = clock.monotonic();
    expect(clock.monotonic()).toBeGreaterThanOrEqual(first);
  });
});
