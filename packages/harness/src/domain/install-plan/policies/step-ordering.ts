import { type ArtifactKind, locatorKey } from "../value-objects/artifact-locator.js";
import type { PlanAction, PlanStep } from "../value-objects/plan-step.js";

/** Containers before what they hold, and files before the entries and registrations that name them. */
const KIND_ORDER: readonly ArtifactKind[] = [
  "dir",
  "file",
  "symlink",
  "managed-block",
  "json-entry",
  "toml-entry",
  "cli-registration"
];

const PHASE: Readonly<Record<PlanAction, number>> = {
  create: 0,
  update: 0,
  adopt: 0,
  remove: 1,
  noop: 2,
  conflict: 3
};

/**
 * The order in which an executor runs the steps: every write first, in KIND_ORDER and then by locator; then removals
 * in exactly the reverse order, so a registration goes before the files it names and a plugin before the marketplace
 * that lists it; then noops. A replacement is written before what it replaces is removed, so an interrupted apply
 * leaves at worst both (which the next plan cleans up), never neither.
 */
export function orderSteps(steps: readonly PlanStep[]): PlanStep[] {
  const rank = (step: PlanStep): number => {
    const kind = KIND_ORDER.indexOf(step.locator.kind);
    return step.action === "remove" ? KIND_ORDER.length - kind : kind;
  };
  const byKey = (a: PlanStep, b: PlanStep): number => {
    const order =
      locatorKey(a.locator) < locatorKey(b.locator) ? -1 : locatorKey(a.locator) > locatorKey(b.locator) ? 1 : 0;
    return a.action === "remove" ? -order : order;
  };
  return steps.toSorted((a, b) => PHASE[a.action] - PHASE[b.action] || rank(a) - rank(b) || byKey(a, b));
}
