import { PlatformService } from "@rivus/agent-kit-platform/effect";
import type { Platform } from "@rivus/agent-kit-platform/public";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { resolvePath } from "./resolve-path.js";

describe("resolvePath", () => {
  it("resolves non-existent relative paths against the platform working directory", async () => {
    const known = new Map<string, string>([
      [".", "/work/repo"],
      ["/work/repo", "/work/repo"],
      ["/u/me", "/u/me"]
    ]);
    const platform = {
      fs: {
        realpath: async (path: string) => known.get(path)
      }
    } as unknown as Platform;
    const run = (target: string, follow = false) =>
      Effect.runPromise(resolvePath(target, follow).pipe(Effect.provideService(PlatformService, platform)));

    expect(await run("new-relative-agents", true)).toBe("/work/repo/new-relative-agents");
    expect(await run("new-relative-agents/skills/demo-skill")).toBe("/work/repo/new-relative-agents/skills/demo-skill");
    expect(await run("./sub/../new-relative-agents", true)).toBe("/work/repo/new-relative-agents");
    expect(await run("/u/me/agents /skills/demo-skill")).toBe("/u/me/agents /skills/demo-skill");
  });
});
