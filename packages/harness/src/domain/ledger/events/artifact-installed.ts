import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { ContentHash } from "../value-objects/content-hash.js";

export interface ArtifactInstalled {
  readonly _tag: "ArtifactInstalled";
  readonly owner: Owner;
  readonly locator: ArtifactLocator;
  readonly action: "create" | "update" | "adopt";
  readonly contentHash: ContentHash;
  readonly revision: number;
}
