import type { ObservedArtifact } from "../spi/observed-artifact.js";

/** Whether the symlink at the locator points nowhere: the link is there, what it names is not. */
export function isBrokenSymlink(observed: ObservedArtifact): boolean {
  return observed.symlinkTarget !== undefined && observed.locator.kind === "symlink" && observed.content === "";
}
