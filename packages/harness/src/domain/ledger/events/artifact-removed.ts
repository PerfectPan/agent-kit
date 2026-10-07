import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { Removal } from "../../install-plan/value-objects/plan-step.js";

export interface ArtifactRemoved {
  readonly _tag: "ArtifactRemoved";
  readonly owner: Owner;
  readonly locator: ArtifactLocator;
  readonly removal: Removal;
  readonly revision: number;
}
