import { err, type Result } from "@rivus/agent-kit-catalog";

import { isLegacyArtifact } from "../../bundle/policies/legacy-markers.js";
import type { Bundle } from "../../bundle/value-objects/bundle.js";
import type { Ledger } from "../../ledger/aggregates/ledger.js";
import type { PendingOperations } from "../../ledger/errors/pending-operations.js";
import { unionAgents } from "../../ledger/policies/ownership.js";
import { InstallPlan } from "../aggregates/install-plan.js";
import type { InvalidPlan } from "../errors/invalid-plan.js";
import type { PlanConflict } from "../errors/plan-conflict.js";
import type { PlanStale } from "../errors/plan-stale.js";
import { type DesiredState, planStep } from "../policies/conflict-detection.js";
import { orderSteps } from "../policies/step-ordering.js";
import { protectedLegacy, protectedReplacement } from "../policies/legacy-ownership.js";
import { type LocatorKey, locatorKey } from "../value-objects/artifact-locator.js";
import type { ConflictChoice } from "../value-objects/conflict.js";
import type { DesiredArtifact } from "../value-objects/desired-artifact.js";
import type { InstallTarget } from "../value-objects/install-target.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import { type PlanStep, touchesDisk } from "../value-objects/plan-step.js";
import type { TrustPrompt } from "../value-objects/trust-prompt.js";

export interface PlanRequest {
  /** Chosen by the caller, such as a random UUID. */
  readonly planId: string;
  /** Checked with `checkBundle`. */
  readonly bundle: Bundle;
  readonly target: InstallTarget;
  /**
   * The bundle's Artifacts as the target agents' strategies render them. Whatever the owner holds for these agents
   * and no longer desires is removed, so an uninstall is a plan with nothing desired.
   */
  readonly desired: readonly DesiredArtifact[];
  /** Explicit choices for conflicting locators. */
  readonly choices?: Readonly<Record<LocatorKey, ConflictChoice>>;
  /**
   * Paths a ForeignOwner such as chezmoi manages, with its name, whether or not anything is at them yet: an entry
   * that is not in its file yet still must not be written into a managed file.
   */
  readonly managedPaths?: Readonly<Record<string, string>>;
  /**
   * Paths that are symlinks, with their targets, whether or not the Artifact is in them yet: an entry must not be
   * written into a linked file, which an atomic write would replace with a regular one.
   */
  readonly linkedPaths?: Readonly<Record<string, string>>;
}

/** Whether the step puts new content at its target, which is what makes an agent ask for trust again. */
const writesContent = (step: PlanStep): boolean => step.action !== "remove" && touchesDisk(step);

/**
 * Builds the plan that brings the target agents from the ledger and the observed files to what the request desires,
 * without IO: `observed` describes what the application found at every desired locator, at every locator the owner
 * holds for these agents, and wherever an older version of the owner may have installed something.
 */
export function buildInstallPlan(
  request: PlanRequest,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): Result<InstallPlan, PendingOperations | PlanStale | InvalidPlan | PlanConflict> {
  const { bundle, target } = request;
  const desired = new Map<LocatorKey, { readonly state: DesiredState; readonly trust: readonly TrustPrompt[] }>();
  for (const artifact of request.desired) {
    const key = locatorKey(artifact.locator);
    const known = desired.get(key);
    if (
      known !== undefined &&
      (known.state.hash !== artifact.hash || known.state.locator.kind !== artifact.locator.kind)
    ) {
      return err({ _tag: "InvalidPlan", reason: "conflicting-desired", locator: artifact.locator });
    }
    const trust: TrustPrompt[] =
      artifact.trust === undefined ? [] : [{ agent: artifact.agent, kind: artifact.trust, locator: artifact.locator }];
    desired.set(key, {
      state: {
        locator: artifact.locator,
        content: artifact.content,
        hash: artifact.hash,
        strategy: known?.state.strategy ?? artifact.strategy,
        agents: unionAgents(known?.state.agents ?? [], [artifact.agent])
      },
      trust: [...(known?.trust ?? []), ...trust]
    });
  }
  const markers = bundle.legacyMarkers ?? [];
  const found = new Map(observed.map((artifact) => [locatorKey(artifact.locator), artifact]));
  const entries = new Map(ledger.entries().map((entry) => [locatorKey(entry.locator), entry]));
  // What the user kept on an earlier removal is theirs, even when it still carries a legacy marker.
  const isLegacy = (key: LocatorKey): boolean => {
    const seen = found.get(key);
    return (
      !entries.has(key) &&
      seen !== undefined &&
      !protectedLegacy(seen.locator, bundle.owner, ledger, observed) &&
      isLegacyArtifact(markers, seen.content)
    );
  };
  const preservedHooks = observed.filter(
    (seen) =>
      request.desired.length > 0 &&
      seen.locator.memberIn === "hook-group" &&
      !entries.has(locatorKey(seen.locator)) &&
      protectedLegacy(seen.locator, bundle.owner, ledger, observed) &&
      protectedReplacement(seen, bundle, target.agents, ledger, observed)
  );
  if (preservedHooks.length > 0) {
    return err({
      _tag: "PlanConflict",
      planId: request.planId,
      conflicts: preservedHooks.map((seen) => ({
        step: {
          locator: seen.locator,
          action: "conflict",
          conflict: "user-modified",
          agents: [],
          precondition: { hash: seen.hash },
          capturePreImage: false
        },
        choices: []
      }))
    });
  }
  const managed = request.managedPaths ?? {};
  const linked = request.linkedPaths ?? {};
  const at = (paths: Readonly<Record<string, string>>, path: string | undefined): string | undefined =>
    path !== undefined && Object.hasOwn(paths, path) ? paths[path] : undefined;
  const foreignOf = (path: string | undefined) => {
    const managedBy = at(managed, path);
    const symlinkTarget = at(linked, path);
    return {
      ...(managedBy === undefined ? {} : { managedBy }),
      ...(symlinkTarget === undefined ? {} : { symlinkTarget })
    };
  };
  const keys = new Set([...desired.keys(), ...entries.keys(), ...[...found.keys()].filter(isLegacy)]);
  const steps = [...keys].flatMap((key) => {
    const step = planStep({
      owner: bundle.owner,
      agents: target.agents,
      desired: desired.get(key)?.state,
      entry: entries.get(key),
      observed: found.get(key),
      legacy: isLegacy(key),
      choice: request.choices?.[key],
      replacing: request.desired.length > 0,
      ...foreignOf(
        desired.get(key)?.state.locator.path ?? entries.get(key)?.locator.path ?? found.get(key)?.locator.path
      )
    });
    return step === undefined ? [] : [step];
  });
  const ordered = orderSteps(steps);
  return InstallPlan.create(
    {
      planId: request.planId,
      basedOn: { ledgerLineage: ledger.lineage, ledgerRevision: ledger.revision },
      bundle: { owner: bundle.owner, version: bundle.version, digest: bundle.digest },
      target,
      steps: ordered,
      expectedTrustPrompts: ordered.flatMap((step) =>
        writesContent(step) ? (desired.get(locatorKey(step.locator))?.trust ?? []) : []
      )
    },
    { ledger, observed, legacyMarkers: markers, managedPaths: managed, linkedPaths: linked }
  );
}
