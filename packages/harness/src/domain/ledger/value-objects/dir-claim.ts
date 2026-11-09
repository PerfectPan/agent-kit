import type { OwnerSnapshot } from "../../bundle/value-objects/owner.js";

/**
 * A directory an install positively created: the ancestors its plan's recursive mkdir brought into being within the
 * resolved installation roots. The apply observes them before it writes and records the claim in the ledger once the
 * step that created them has succeeded, so an apply that dies first claims nothing. The claim names every owner whose
 * install created the directory, so an uninstall removes it only after its last owner's use ends. Provenance is
 * never inferred: a directory a schema-1 ledger predates, or one whose creation is uncertain, stays unclaimed and
 * survives cleanup, however empty it is.
 */
export interface DirClaimSnapshot {
  readonly path: string;
  /** The owners whose installs created the directory, sorted without repeats. */
  readonly owners: readonly OwnerSnapshot[];
  /** The ledger revision that last changed the claim. */
  readonly entryRevision: number;
}

/** Why a directory claim cannot be recorded as it stands. */
export type InvalidDirClaim = { readonly _tag: "InvalidDirClaim"; readonly reason: string; readonly path: string };

const isRevision = (revision: number): boolean => Number.isInteger(revision) && revision >= 0;

/** POSIX absolute, a leading separator, or a drive letter: what an installation root resolves to on each platform. */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\") || WINDOWS_DRIVE.test(path);

/** Judges one claim's own fields; the ledger checks the map around them. */
export function dirClaimProblem(claim: DirClaimSnapshot): InvalidDirClaim | undefined {
  if (typeof claim.path !== "string" || claim.path === "" || !isAbsolutePath(claim.path)) {
    return { _tag: "InvalidDirClaim", reason: "directory claim path is not absolute", path: String(claim.path) };
  }
  if (!Array.isArray(claim.owners) || claim.owners.length === 0 || new Set(claim.owners).size !== claim.owners.length) {
    return { _tag: "InvalidDirClaim", reason: "directory claim owners are empty or repeated", path: claim.path };
  }
  if ([...claim.owners].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",") !== claim.owners.join(",")) {
    return { _tag: "InvalidDirClaim", reason: "directory claim owners are not sorted", path: claim.path };
  }
  if (!isRevision(claim.entryRevision)) {
    return {
      _tag: "InvalidDirClaim",
      reason: "directory claim revision is not a non-negative integer",
      path: claim.path
    };
  }
  return undefined;
}
