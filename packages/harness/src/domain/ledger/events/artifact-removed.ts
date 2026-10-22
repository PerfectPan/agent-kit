import type { OwnerSnapshot } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocatorSnapshot } from "../../install-plan/value-objects/artifact-locator.js";
import type { Removal } from "../../install-plan/value-objects/plan-step.js";

export interface ArtifactRemoved {
  readonly _tag: "ArtifactRemoved";
  readonly owner: OwnerSnapshot;
  readonly locator: ArtifactLocatorSnapshot;
  readonly removal: Removal;
  readonly revision: number;
}
