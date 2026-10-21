import { deepFreeze } from "../../../lib/deep-freeze.js";
import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";

/** The installed-copy read the use case made; `isFile` distinguishes a readable copy from a directory or nothing. */
export interface InstalledCopyRead {
  readonly isFile: boolean;
  readonly content: ArtifactContent;
}

export class RegistrationState {
  readonly #record: ArtifactContent | undefined;
  readonly #options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead };

  private constructor(
    record: ArtifactContent | undefined,
    options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead }
  ) {
    this.#record = deepFreeze(structuredClone(record));
    this.#options = deepFreeze(structuredClone(options));
    Object.freeze(this);
  }

  static observe(
    record: ArtifactContent | undefined,
    options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead }
  ): RegistrationState {
    return new RegistrationState(record, options);
  }

  /**
   * The current content of a cli-registration (see `CliRegistration.installedCopy`): an active registration with an
   * installed copy reads as that copy's text, so an outdated copy is planned again; when the copy is not a readable
   * file the registration reads as `true`. A record explicitly disabled (`false`) stays `false`, and a registration
   * without a copy reads as the record itself.
   */
  content(): ArtifactContent | undefined {
    const { installedCopy, copy } = this.#options;
    if (installedCopy === undefined || this.#record === false) {
      return this.#record;
    }
    return copy?.isFile === true ? copy.content : true;
  }
}
