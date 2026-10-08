import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import { isLegacyArtifact } from "../../bundle/policies/legacy-markers.js";
import type { Bundle } from "../../bundle/value-objects/bundle.js";
import type { Owner } from "../../bundle/value-objects/owner.js";
import type { Ledger } from "../../ledger/aggregates/ledger.js";
import type { ArtifactLocator } from "../value-objects/artifact-locator.js";
import { locatorKey } from "../value-objects/artifact-locator.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";

/** A renamed hook cannot be distinguished from a deleted hook followed by a user's hook in the same event. */
export function protectedLegacy(
  locator: ArtifactLocator,
  owner: Owner,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): boolean {
  return ledger.kept(locator) !== undefined || missingOwnedHook(locator, owner, ledger, observed);
}

function missingOwnedHook(
  locator: ArtifactLocator,
  owner: Owner,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): boolean {
  return (
    locator.memberIn === "hook-group" &&
    ledger
      .entries()
      .some(
        (entry) =>
          entry.owners.includes(owner) &&
          entry.locator.memberIn === "hook-group" &&
          entry.locator.path === locator.path &&
          entry.locator.pointer === locator.pointer &&
          !observed.some((found) => locatorKey(found.locator) === locatorKey(entry.locator))
      )
  );
}

/** Kept hooks remain protected from every owner's cleanup; only a related replacement is blocked. */
export function protectedReplacement(
  seen: ObservedArtifact,
  bundle: Bundle,
  agents: readonly CodingAgentId[],
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): boolean {
  return (
    ledger.kept(seen.locator, bundle.owner) !== undefined ||
    missingOwnedHook(seen.locator, bundle.owner, ledger, observed) ||
    isLegacyArtifact(bundle.legacyMarkers ?? [], seen.content) ||
    bundle.artifacts.some(
      (spec) =>
        spec.type === "hooks" &&
        agents.some(
          (agent) =>
            (spec.events[agent]?.length ?? 0) > 0 && spec.command.replaceAll("{agent}", agent) === seen.locator.member
        )
    )
  );
}
