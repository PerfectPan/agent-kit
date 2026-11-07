import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { agentEnv } from "../src/acp.js";
import { builtinProviders } from "../src/providers.js";

const profile = builtinProviders.find((provider) => provider.id === "dsh")!.acp!;

describe("dsh launch environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("preserves permission mode and bundled skills from process.env", () => {
    vi.stubEnv("DSH_PERMISSION_MODE", "read-only");
    vi.stubEnv("DSH_BUNDLED_SKILL_DIR", "/bundled/skills");
    const env = agentEnv(profile, process.env);
    expect(env.DSH_PERMISSION_MODE).toBe("read-only");
    expect(env.DSH_BUNDLED_SKILL_DIR).toBe("/bundled/skills");
  });

  it("drops speech-worker tokens and subprocess markers from process.env", () => {
    vi.stubEnv("DSH_SPEECH_TOKEN", "worker-only");
    vi.stubEnv("DSH_SUBPROCESS_CONTROL", "subprocess-only");
    vi.stubEnv("DSH_SUBPROCESS_RUNNER", "runner-only");
    const env = agentEnv(profile, process.env);
    expect(env.DSH_SPEECH_TOKEN).toBeUndefined();
    expect(env.DSH_SUBPROCESS_CONTROL).toBeUndefined();
    expect(env.DSH_SUBPROCESS_RUNNER).toBeUndefined();
  });
});
