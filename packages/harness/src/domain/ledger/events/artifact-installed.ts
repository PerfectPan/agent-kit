import type { OwnerSnapshot } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocatorSnapshot } from "../../install-plan/value-objects/artifact-locator.js";
import type { ContentHash } from "../value-objects/content-hash.js";

export interface ArtifactInstalled {
  readonly _tag: "ArtifactInstalled";
  readonly owner: OwnerSnapshot;
  readonly locator: ArtifactLocatorSnapshot;
  readonly action: "create" | "update" | "adopt";
  readonly contentHash: ContentHash;
  readonly revision: number;
}
