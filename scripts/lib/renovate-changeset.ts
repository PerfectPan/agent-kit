import { isPublishable, type WorkspacePackage } from "./workspace.ts";

/** Catalog changes include dev-only entries; release notes should name only dependencies consumers install. */
export function filterDependencyUpdates(changeset: string, packages: readonly WorkspacePackage[]): string {
  const runtimeDependencies = new Set(
    packages
      .filter(isPublishable)
      .flatMap(({ manifest }) => [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {})
      ])
  );
  let retainedUpdate = false;
  const lines: string[] = [];
  for (const line of changeset.split("\n")) {
    const match = /^Updated dependency `([^`]+)` /u.exec(line);
    if (match === null) {
      lines.push(line);
    } else if (runtimeDependencies.has(match[1]!)) {
      lines.push(line);
      retainedUpdate = true;
    }
  }
  // An unexpected format or dependency lookup must not turn an existing release note into an empty summary.
  return retainedUpdate ? lines.join("\n") : changeset;
}
