import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import { ArtifactSpec, type ArtifactSpecSnapshot } from "./artifact-spec.js";
import { Owner, type OwnerSnapshot } from "./owner.js";

/** What one Owner wants installed into the agents' harnesses. */
export interface BundleSnapshot {
  readonly owner: OwnerSnapshot;
  readonly version: string;
  /** Identifies the artifacts' content, such as a hash the owner computes over them. */
  readonly digest: string;
  readonly artifacts: readonly ArtifactSpecSnapshot[];
  /**
   * Substrings by which the owner recognizes what its older versions installed without a ledger, such as their hook
   * command lines. Such artifacts are replaced or removed instead of being installed a second time.
   */
  readonly legacyMarkers?: readonly string[];
}

export type BundleRef = Pick<BundleSnapshot, "owner" | "version" | "digest">;

export interface InvalidBundle {
  readonly _tag: "InvalidBundle";
  readonly reason: string;
}

export class Bundle {
  readonly #snapshot: BundleSnapshot;
  readonly #owner: Owner;
  readonly #artifacts: readonly ArtifactSpec[];

  private constructor(input: BundleSnapshot, owner: Owner, artifacts: readonly ArtifactSpec[]) {
    const snapshot = structuredClone(input);
    this.#owner = owner;
    this.#artifacts = Object.freeze([...artifacts]);
    this.#snapshot = Object.freeze({
      ...snapshot,
      owner: owner.toSnapshot(),
      artifacts: Object.freeze(this.#artifacts.map((spec) => spec.toSnapshot())),
      ...(snapshot.legacyMarkers === undefined ? {} : { legacyMarkers: Object.freeze(snapshot.legacyMarkers) })
    });
    Object.freeze(this);
  }

  get owner(): Owner {
    return this.#owner;
  }
  get artifacts(): readonly ArtifactSpec[] {
    return this.#artifacts;
  }
  legacyMarkers(): readonly string[] {
    return this.#snapshot.legacyMarkers ?? [];
  }
  toSnapshot(): BundleSnapshot {
    return this.#snapshot;
  }

  static restore(bundle: BundleSnapshot): Result<Bundle, InvalidBundle> {
    const invalid = (reason: string) => err<InvalidBundle>({ _tag: "InvalidBundle", reason });
    const owner = Owner.restore(bundle.owner);
    if (!owner.ok) {
      return owner;
    }
    if (bundle.version === "" || bundle.digest === "") {
      return invalid("version and digest must not be empty");
    }
    if ((bundle.legacyMarkers ?? []).some((marker) => marker.trim() === "")) {
      return invalid("an empty legacy marker would match everything");
    }
    const seen = new Set<string>();
    const artifacts: ArtifactSpec[] = [];
    for (const artifact of bundle.artifacts) {
      const restored = ArtifactSpec.restore(artifact);
      if (!restored.ok) {
        return restored;
      }
      artifacts.push(restored.value);
      const name = artifact.type === "hooks" ? "" : artifact.type === "instructions" ? artifact.id : artifact.name;
      if (seen.has(`${artifact.type}:${name}`)) {
        return invalid(artifact.type === "hooks" ? "more than one hook spec" : `duplicate ${artifact.type} "${name}"`);
      }
      seen.add(`${artifact.type}:${name}`);
    }
    return ok(new Bundle(bundle, owner.value, artifacts));
  }
}
/**
 * The inputs of an operation that works for one owner without a bundle (`uninstall`, the read-only legacy listing),
 * checked through `Bundle.restore` with an artifact-less bundle: the owner is a package-style name and no marker is
 * blank, which would match everything. The returned bundle carries nothing else an operation needs.
 */
export function checkOwnerMarkers(
  owner: OwnerSnapshot,
  legacyMarkers: readonly string[]
): Result<Bundle, InvalidBundle> {
  return Bundle.restore({ owner, version: "uninstall", digest: "uninstall", artifacts: [], legacyMarkers });
}
