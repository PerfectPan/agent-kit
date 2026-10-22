import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";
import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { ArtifactSource } from "../../domain/bundle/spi/install-adapter.js";
import { type LegacyHookSource } from "../../domain/install-plan/factories/plan-evidence-scope.js";
import { pointerTail } from "../../domain/install-plan/value-objects/artifact-locator.js";
import type { ObservedArtifact } from "../../domain/install-plan/spi/observed-artifact.js";
import { ArtifactFiles, type ArtifactFailure } from "../ports.js";
import { observation } from "./observe.js";
import { resolvePath } from "./resolve-path.js";

/** One legacy find: what was observed, the agent it is effective in, and for a foreign file the runner and event. */
export interface LegacyObservation {
  readonly observed: ObservedArtifact;
  /** The agent the find is effective in: the source's own agent, or the runner of another agent's file. */
  readonly agent: CodingAgentId;
  /** The selected agent that also executes this other agent's file; set exactly for a foreign source. */
  readonly runner?: CodingAgentId;
  /** The event that fires the find, as the runner names it, when the source renames events. */
  readonly event?: string;
}

/**
 * Reads every legacy source and observes each entry it holds, in source order: a source's declared paths resolved by
 * the locator convention, each find with its event under the pointer (a source that names runner events takes only
 * those, recorded back under the runner's name).
 */
export function scanLegacy(
  sources: readonly LegacyHookSource[]
): Effect.Effect<readonly LegacyObservation[], ArtifactFailure, ArtifactFiles | PlatformService> {
  return Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    const found: LegacyObservation[] = [];
    for (const { source, agent, events, runner, runAs } of sources) {
      const resolved: ArtifactSource =
        source.kind === "files"
          ? { ...source, dir: yield* resolvePath(source.dir, true) }
          : { ...source, path: yield* resolvePath(source.path) };
      for (const { locator, read } of yield* files.scan(resolved)) {
        const event = pointerTail(locator.pointer);
        if (events === undefined || (event !== undefined && events.has(event))) {
          found.push({
            observed: yield* observation(locator, read),
            agent,
            ...(runner === undefined ? {} : { runner }),
            ...(event === undefined || runAs?.[event] === undefined ? {} : { event: runAs[event] })
          });
        }
      }
    }
    return found;
  });
}
