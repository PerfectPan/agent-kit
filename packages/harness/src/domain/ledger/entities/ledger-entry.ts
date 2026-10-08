import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { ContentHash } from "../value-objects/content-hash.js";
import type { PreImage } from "../value-objects/pre-image.js";

/**
 * The Ledger's record of one Artifact. A file shared with other tools is recorded per entry inside it; a whole file
 * only when harness created it or the user adopted it.
 */
export interface LedgerEntry {
  readonly locator: ArtifactLocator;
  /** Every owner that installed this content; never empty. Uninstalling one hands the Artifact to the others. */
  readonly owners: readonly Owner[];
  /** The owner whose content is on disk; one of `owners`. */
  readonly activeOwner: Owner;
  /** The agents that use the Artifact, such as several agents reading one skills directory; never empty. */
  readonly agents: readonly CodingAgentId[];
  /** The active owner's bundle version that last recorded it. */
  readonly bundleVersion: string;
  /** The kit version that last wrote it. */
  readonly toolVersion: string;
  readonly contentHash: ContentHash;
  readonly preImage: PreImage;
  readonly appliedAt: string;
  /** The ledger revision that last changed this entry. */
  readonly entryRevision: number;
}
