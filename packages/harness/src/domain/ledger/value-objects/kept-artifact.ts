import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";

/**
 * An Artifact an owner let go of on removal because the user had changed it: it stays on disk as the user's. No later
 * plan takes it for what an older version of an owner left without a ledger, even when it still carries a legacy
 * marker. A hook-group record protects every command at the same path and event, because changing a command changes
 * its locator member; removing a missing hook records this protection too, since deletion and renaming cannot be
 * distinguished. A replacement by the same owner, or matching the hook's command or a legacy marker, is refused
 * while such an untracked hook remains. Another owner's unrelated hooks can coexist without lifting deletion protection.
 * The exact record goes once something is recorded at its locator again.
 */
export interface KeptArtifact {
  readonly locator: ArtifactLocator;
  readonly owner: Owner;
  readonly keptAt: string;
}
