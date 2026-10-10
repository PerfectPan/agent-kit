import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import { isLegacyArtifact } from "../../bundle/policies/legacy-markers.js";
import { type Bundle, legacyMarkersOf } from "../../bundle/value-objects/bundle.js";
import type { Owner } from "../../bundle/value-objects/owner.js";
import type { HookDialects } from "../../lifecycle/value-objects/hook-dialect.js";
import { aliasesOf } from "../../lifecycle/value-objects/hook-dialect.js";
import type { Ledger } from "../../ledger/aggregates/ledger.js";
import { holds } from "../../ledger/policies/ownership.js";
import type { PlanConflict } from "../errors/plan-conflict.js";
import type { ArtifactLocator } from "../value-objects/artifact-locator.js";
import { locatorKey } from "../value-objects/artifact-locator.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import type { PlanStep } from "../value-objects/plan-step.js";

/** A foreign hook observed in a file a selected runner executes, with the runner and the event it fires it as. */
export interface ForeignHookObservation {
  readonly observed: ObservedArtifact;
  readonly runner: CodingAgentId;
  /** The event name in the runner's own dialect, after its rename. */
  readonly event: string;
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

/** A renamed hook cannot be distinguished from a deleted hook followed by a user's hook in the same event. */
export function protectedLegacy(
  locator: ArtifactLocator,
  owner: Owner,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): boolean {
  return ledger.kept(locator) !== undefined || missingOwnedHook(locator, owner, ledger, observed);
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
    isLegacyArtifact(legacyMarkersOf(bundle), seen.content) ||
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

/** Whether the runner installs a hook for the same event, under the event's own name or one of its dialect aliases. */
function bundleFiresEvent(bundle: Bundle, runner: CodingAgentId, event: string, dialects: HookDialects): boolean {
  const aliases = new Set(aliasesOf(dialects[runner]?.events, event));
  return bundle.artifacts.some(
    (spec) => spec.type === "hooks" && spec.events[runner]?.some((name) => name === event || aliases.has(name)) === true
  );
}

/**
 * Whether a foreign hook the plan would leave behind is still tracked by the owner and wanted for another consumer.
 * A selected runner executes the hook as `event`; the bundle installs that same event (or a dialect alias) for the
 * runner; the owner tracks it in its ledger; and the plan leaves it where it is (no step, or a removal other than a
 * delete). Replacing the file would silently drop that consumer's hook, so this is an unresolvable conflict.
 */
export function retainsForeignHook(
  item: ForeignHookObservation,
  context: {
    readonly bundle: Bundle;
    readonly dialects: HookDialects;
    readonly ledger: Ledger;
    readonly steps: readonly PlanStep[];
  }
): boolean {
  const { bundle, dialects, ledger, steps } = context;
  const entry = ledger.entry(item.observed.locator);
  if (
    entry === undefined ||
    !holds(entry, bundle.owner) ||
    !bundleFiresEvent(bundle, item.runner, item.event, dialects)
  ) {
    return false;
  }
  const step = steps.find((candidate) => locatorKey(candidate.locator) === locatorKey(item.observed.locator));
  return step === undefined || (step.action === "remove" && step.removal !== "delete");
}

/** The conflict for one retained foreign hook, which no choice can resolve. */
export function retainedForeignConflict(
  planId: string,
  items: readonly ForeignHookObservation[],
  context: {
    readonly bundle: Bundle;
    readonly dialects: HookDialects;
    readonly ledger: Ledger;
    readonly steps: readonly PlanStep[];
  }
): PlanConflict | undefined {
  const conflicts = items.flatMap((item) => {
    if (!retainsForeignHook(item, context)) {
      return [];
    }
    const entry = context.ledger.entry(item.observed.locator);
    return [
      {
        step: {
          locator: item.observed.locator,
          action: "conflict" as const,
          conflict: "other-owner" as const,
          agents: entry?.agents ?? [],
          precondition: { hash: item.observed.hash },
          capturePreImage: false
        },
        choices: [] as const
      }
    ];
  });
  return conflicts.length > 0 ? { _tag: "PlanConflict", planId, conflicts } : undefined;
}
