import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import type { InvalidLedger } from "../errors/invalid-ledger.js";
import { locatorProblem } from "../../install-plan/value-objects/artifact-locator.js";
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
export interface KeptArtifactSnapshot {
  readonly locator: ArtifactLocator;
  readonly owner: Owner;
  readonly keptAt: string;
}

/** A validated, immutable child of the Ledger; only the root restores or replaces it. */
export class KeptArtifact {
  declare readonly locator: ArtifactLocator;
  declare readonly owner: Owner;
  declare readonly keptAt: string;

  static restore(snapshot: KeptArtifactSnapshot): Result<KeptArtifact, InvalidLedger> {
    const reason =
      locatorProblem(snapshot.locator) !== undefined || snapshot.owner === ""
        ? "a kept Artifact has an invalid locator or no owner"
        : undefined;
    return reason === undefined ? ok(new KeptArtifact(snapshot)) : err({ _tag: "InvalidLedger", reason });
  }

  readonly #snapshot: KeptArtifactSnapshot;

  private constructor(snapshot: KeptArtifactSnapshot) {
    Object.freeze(snapshot.locator);
    this.#snapshot = Object.freeze(snapshot);
    Object.assign(this, snapshot);
    Object.freeze(this);
  }

  toSnapshot(): KeptArtifactSnapshot {
    return this.#snapshot;
  }
}
