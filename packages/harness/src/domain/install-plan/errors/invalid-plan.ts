import type { ArtifactLocator } from "../value-objects/artifact-locator.js";

/**
 * A plan that breaks an invariant. `invalid-locator`: a path that is not absolute and normalized, or a pointer or
 * member that does not fit the kind. `outside-roots`: a path outside the target's roots. `overlapping-locators`: two
 * steps on one locator, or one inside the other. `invalid-step`: inconsistent step fields, such as an invalid hash or a
 * conflict without a reason. `not-owned`: a step on something the owner may not change, such as a removal of what it
 * does not hold alone. `conflicting-desired`: two agents want different content at one locator.
 */
export interface InvalidPlan {
  readonly _tag: "InvalidPlan";
  readonly reason:
    | "invalid-locator"
    | "outside-roots"
    | "overlapping-locators"
    | "invalid-step"
    | "not-owned"
    | "conflicting-desired";
  readonly locator: ArtifactLocator;
  readonly detail?: string;
}
