import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { ArtifactSpec } from "./artifact-spec.js";
import { type Owner, OWNER_PATTERN } from "./owner.js";

/** What one Owner wants installed into the agents' harnesses. */
export interface Bundle {
  readonly owner: Owner;
  readonly version: string;
  /** Identifies the artifacts' content, such as a hash the owner computes over them. */
  readonly digest: string;
  readonly artifacts: readonly ArtifactSpec[];
  /**
   * Substrings by which the owner recognizes what its older versions installed without a ledger, such as their hook
   * command lines. Such artifacts are replaced or removed instead of being installed a second time.
   */
  readonly legacyMarkers?: readonly string[];
}

export type BundleRef = Pick<Bundle, "owner" | "version" | "digest">;

/**
 * The substrings by which the owner recognizes what its older versions installed. A bundle is caller data, so the
 * optional list is read live through this one accessor at every site: a bundle that names none — or names `null` —
 * has none.
 */
export function legacyMarkersOf(bundle: Bundle): readonly string[] {
  return bundle.legacyMarkers ?? [];
}

export interface InvalidBundle {
  readonly _tag: "InvalidBundle";
  readonly reason: string;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Starts with a letter or `_`, so that as a JSON pointer segment it never reads as an array index (`0`, `-`). */
const MCP_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A relative `/`-separated path that cannot leave its directory. */
const isRelativeFile = (path: string): boolean =>
  !path.includes("\\") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

function artifactProblem(artifact: ArtifactSpec): string | undefined {
  switch (artifact.type) {
    case "hooks":
      if (artifact.command.trim() === "") {
        return "hook command is empty";
      }
      if (
        artifact.timeoutSeconds !== undefined &&
        !(Number.isFinite(artifact.timeoutSeconds) && artifact.timeoutSeconds > 0)
      ) {
        return "hook timeout is not a positive number of seconds";
      }
      return Object.values(artifact.events).some((events) => events?.some((event) => event === ""))
        ? "hook event name is empty"
        : undefined;
    case "skill":
      if (!NAME.test(artifact.name) || artifact.name.length > 64) {
        return `skill name "${artifact.name}" is not lowercase letters, digits and hyphens`;
      }
      if (!Object.hasOwn(artifact.files, "SKILL.md")) {
        return `skill "${artifact.name}" has no SKILL.md`;
      }
      return Object.keys(artifact.files).every(isRelativeFile)
        ? undefined
        : `skill "${artifact.name}" has a file path that leaves its directory`;
    case "mcp-server":
      return MCP_NAME.test(artifact.name)
        ? undefined
        : `MCP server name "${artifact.name}" does not start with a letter or "_" followed by letters, digits, "_" or "-"`;
    case "instructions":
      return NAME.test(artifact.id)
        ? undefined
        : `instructions id "${artifact.id}" is not lowercase letters, digits and hyphens`;
  }
}

/** Checks what strategies rely on: names usable as file names and block ids, unique per type, one hook spec. */
export function checkBundle(bundle: Bundle): Result<Bundle, InvalidBundle> {
  const invalid = (reason: string) => err<InvalidBundle>({ _tag: "InvalidBundle", reason });
  if (!OWNER_PATTERN.test(bundle.owner)) {
    return invalid(`owner "${bundle.owner}" is not a package-style name`);
  }
  if (bundle.version === "" || bundle.digest === "") {
    return invalid("version and digest must not be empty");
  }
  if (legacyMarkersOf(bundle).some((marker) => marker.trim() === "")) {
    return invalid("an empty legacy marker would match everything");
  }
  const seen = new Set<string>();
  for (const artifact of bundle.artifacts) {
    const problem = artifactProblem(artifact);
    if (problem !== undefined) {
      return invalid(problem);
    }
    const name = artifact.type === "hooks" ? "" : artifact.type === "instructions" ? artifact.id : artifact.name;
    if (seen.has(`${artifact.type}:${name}`)) {
      return invalid(artifact.type === "hooks" ? "more than one hook spec" : `duplicate ${artifact.type} "${name}"`);
    }
    seen.add(`${artifact.type}:${name}`);
  }
  return ok(bundle);
}
