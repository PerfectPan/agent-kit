import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import type { InvalidBundle } from "./bundle.js";
/** The application on whose behalf Artifacts are installed, named like an npm package: `agent-presence`, `@scope/app`. */
export type OwnerSnapshot = string;

const OWNER_PATTERN: RegExp = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export class Owner {
  static restore(value: OwnerSnapshot): Result<Owner, InvalidBundle> {
    return OWNER_PATTERN.test(value)
      ? ok(new Owner(value))
      : err({ _tag: "InvalidBundle", reason: `owner "${value}" is not a package-style name` });
  }

  readonly #value: OwnerSnapshot;

  private constructor(value: OwnerSnapshot) {
    this.#value = value;
    Object.freeze(this);
  }

  toSnapshot(): OwnerSnapshot {
    return this.#value;
  }
}
