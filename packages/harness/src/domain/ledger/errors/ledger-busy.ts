/** Another process holds the LedgerLock of this scope. */
export interface LedgerBusy {
  readonly _tag: "LedgerBusy";
  readonly scope: string;
  /** What the holder recorded about itself, for diagnostics only; it may be out of date. */
  readonly holder?: string;
}
