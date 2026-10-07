/**
 * The process that holds a lease, with the same shape as the Platform's `ProcessIdentity`. The start time tells a
 * reused pid apart from the holder; the boot id tells a process of an earlier boot apart.
 */
export interface Holder {
  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  readonly startTime: number;
}

/** `unknown` when the holder runs on another host, where the observer cannot look it up. */
export type HolderLiveness = "alive" | "dead" | "unknown";
