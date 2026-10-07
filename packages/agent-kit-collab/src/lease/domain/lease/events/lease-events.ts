export interface LeaseAcquired {
  readonly _tag: "LeaseAcquired";
  readonly key: string;
  readonly generation: number;
  readonly holderId: string;
  /** The holder it took over from, `null` for a new record or a tombstone. */
  readonly previousHolderId: string | null;
}

export interface LeaseRenewed {
  readonly _tag: "LeaseRenewed";
  readonly key: string;
  readonly generation: number;
  readonly revision: number;
}

export interface LeaseReleased {
  readonly _tag: "LeaseReleased";
  readonly key: string;
  readonly generation: number;
  readonly holderId: string;
}

export type LeaseEvent = LeaseAcquired | LeaseRenewed | LeaseReleased;
