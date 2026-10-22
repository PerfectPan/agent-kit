import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ArtifactFiles } from "../src/application/ports.js";
import { observe } from "../src/application/services/observe.js";
import { removeTestHomes, testHome } from "./support/home.js";

afterEach(removeTestHomes);

it.live("observes directory content without copying or freezing the read file map", () => {
  const home = testHome();
  const content = { "SKILL.md": "skill", "scripts/run.js": "run" };
  return Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    const found = yield* observe({ kind: "dir", path: home.path("skill") }).pipe(
      Effect.provideService(ArtifactFiles, {
        ...files,
        read: () => Effect.succeed({ kind: "dir", content })
      })
    );
    expect(found?.content).toBe(content);
    expect(Object.isFrozen(content)).toBe(false);
  }).pipe(Effect.provide(home.layer()));
});
