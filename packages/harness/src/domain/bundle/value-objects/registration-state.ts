import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";

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
/** Deep-freeze helper: the observed record and copy remain detached from their caller. */
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      freeze(inner);
    }
  }
  return value;
}

export class RegistrationState {
  readonly #record: ArtifactContent | undefined;
  readonly #options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead };

  private constructor(
    record: ArtifactContent | undefined,
    options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead }
  ) {
    this.#record = freeze(structuredClone(record));
    this.#options = freeze(structuredClone(options));
    Object.freeze(this);
  }

  static observe(
    record: ArtifactContent | undefined,
    options: { readonly installedCopy?: string; readonly copy?: InstalledCopyRead }
  ): RegistrationState {
    return new RegistrationState(record, options);
  }

  content(): ArtifactContent | undefined {
    const { installedCopy, copy } = this.#options;
    if (installedCopy === undefined || this.#record === false) {
      return this.#record;
    }
    return copy?.isFile === true ? copy.content : true;
  }
}
