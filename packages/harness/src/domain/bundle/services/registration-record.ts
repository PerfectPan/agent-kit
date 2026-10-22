import type { ArtifactLocatorSnapshot } from "../../install-plan/value-objects/artifact-locator.js";
import type { CliRegistration } from "../spi/install-adapter.js";
/**
 * The command line's own record for one planned registration: the recorded entry with the locator's pointer and
 * member. `undefined` when the command line declares no such record.
 */
export function ownRecordOf(
  registration: CliRegistration,
  ref: { readonly pointer?: string; readonly member?: string }
): ArtifactLocatorSnapshot | undefined {
  return registration.recorded?.entries.find((entry) => entry.pointer === ref.pointer && entry.member === ref.member);
}

/**
 * Whether the command's own record resolves to a path other than the planned locator's path: the agent home is reached
 * through a symlink, so a command-line mutation would land at another target and must be refused. The use case
 * normalizes the record path through the resolved adapter roots before this.
 */
export function registrationLinkMismatch(locatorPath: string, normalizedRecordPath: string | undefined): boolean {
  return normalizedRecordPath !== undefined && normalizedRecordPath !== locatorPath;
}
