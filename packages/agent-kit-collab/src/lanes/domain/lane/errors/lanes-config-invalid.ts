/** `maxConcurrent`, `maxQueued` or `turnTimeoutMs` is out of range. */
export interface LanesConfigInvalid {
  readonly _tag: "LanesConfigInvalid";
  readonly message: string;
}
