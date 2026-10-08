import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ExternalOwner, type ExternalOwnerShape } from "../../application/ports.js";
import { resolvePath } from "../../application/services/resolve-path.js";
import { findOnPath } from "../services/path-lookup.js";

const TIMEOUT_MS = 10_000;

function makeChezmoiOwner(platform: Platform): ExternalOwnerShape {
  const managed = Effect.gen(function* () {
    const chezmoi = yield* Effect.promise(() => findOnPath(platform, "chezmoi"));
    if (chezmoi === undefined) {
      return new Set<string>();
    }
    // Read-only: lists the targets chezmoi would write on its next `apply`.
    const result = yield* Effect.promise(() =>
      platform.process
        .run(chezmoi, ["managed", "--path-style", "absolute"], { timeoutMs: TIMEOUT_MS })
        .catch(() => undefined)
    );
    if (result === undefined || result.code !== 0 || result.timedOut) {
      return new Set<string>();
    }
    return new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
    );
  });
  const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return {
    managedPaths: (paths) =>
      Effect.gen(function* () {
        // chezmoi prints targets as it spells them under the home; planned paths have their directories resolved,
        // so the targets are resolved the same way before comparing (only those with a name that could match).
        const names = new Set(paths.map(baseName));
        const resolved = new Set<string>();
        for (const target of yield* managed) {
          if (names.has(baseName(target))) {
            resolved.add(yield* Effect.orElseSucceed(resolvePath(target), () => target));
          }
        }
        return new Map(paths.filter((path) => resolved.has(path)).map((path) => [path, "chezmoi"]));
      }).pipe(Effect.provideService(PlatformService, platform))
  };
}

/**
 * chezmoi as the ExternalOwner: the paths `chezmoi managed` lists (absolute target paths) are left alone, since chezmoi
 * would undo a write to them on its next `apply`. Without chezmoi on `PATH`, or when it cannot list its targets,
 * nothing is managed. It only reads chezmoi's state.
 */
export const ChezmoiExternalOwnerLive: Layer.Layer<ExternalOwner, never, PlatformService> = Layer.effect(
  ExternalOwner,
  Effect.gen(function* () {
    return makeChezmoiOwner(yield* PlatformService);
  })
);
