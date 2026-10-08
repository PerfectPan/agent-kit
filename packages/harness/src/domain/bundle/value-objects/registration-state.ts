import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { CliRegistration } from "./install-adapter.js";

/** The installed-copy read the use case made; `isFile` distinguishes a readable copy from a directory or nothing. */
export interface InstalledCopyRead {
  readonly isFile: boolean;
  readonly content: ArtifactContent;
}

/**
 * The current content of a cli-registration, as the domain defines it (documented on `CliRegistration.installedCopy`):
 * an active registration with an installed copy reads as that copy's text, so an outdated copy is planned again; when
 * the copy is not a readable file the registration reads as `true`. A record explicitly disabled (`false`) stays
 * `false`, and a registration without a copy reads as the record itself.
 */
export function registrationContent(
  record: ArtifactContent | undefined,
  options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead }
): ArtifactContent | undefined {
  const { installedCopy, copy } = options;
  if (installedCopy === undefined || record === false) {
    return record;
  }
  return copy?.isFile === true ? copy.content : true;
}

/**
 * The command line's own record for one planned registration: the recorded entry with the locator's pointer and
 * member. `undefined` when the command line declares no such record.
 */
export function ownRecordOf(
  registration: CliRegistration,
  ref: { readonly pointer?: string; readonly member?: string }
): ArtifactLocator | undefined {
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
