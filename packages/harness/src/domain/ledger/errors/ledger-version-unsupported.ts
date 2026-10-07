/**
 * The stored ledger has a `schemaVersion` this kit does not know, such as one written by a newer kit. Nothing may be
 * written over it: the caller refuses to modify the ledger and keeps the file as it is.
 */
export interface LedgerVersionUnsupported {
  readonly _tag: "LedgerVersionUnsupported";
  readonly schemaVersion: unknown;
  readonly supported: readonly number[];
}
