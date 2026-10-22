/**
 * The process that holds a lease, with the same shape as the Platform's `ProcessIdentity`. The start time tells a
 * reused pid apart from the holder; the boot id tells a process of an earlier boot apart.
 */
export interface HolderSnapshot {
  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  readonly startTime: number;
}

/** `unknown` when the holder runs on another host, where the observer cannot look it up. */
export type HolderLiveness = "alive" | "dead" | "unknown";

export class Holder {
  static problem(snapshot: HolderSnapshot): string | undefined {
    return !Number.isFinite(snapshot.pid) || !Number.isFinite(snapshot.startTime)
      ? "holder pid and startTime must be finite numbers"
      : undefined;
  }

  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  readonly startTime: number;

  constructor(snapshot: HolderSnapshot) {
    const problem = Holder.problem(snapshot);
    if (problem !== undefined) {
      throw new Error(problem);
    }
    this.host = snapshot.host;
    this.bootId = snapshot.bootId;
    this.pid = snapshot.pid;
    this.startTime = snapshot.startTime;
    Object.freeze(this);
  }

  /**
   * Judges a recorded holder from the observer's machine. `current` is what the observer's platform reports for the
   * holder's pid now (`identify(holder.pid)`), `undefined` when no such process exists. A process of an earlier boot is
   * dead; a pid now owned by a process with another start time is a reused pid, so the holder is dead too.
   *
   * Holder and observer must see the same processes: same host name and boot id are taken to mean one process table.
   * Containers that share the host's name and kernel but have their own PID namespaces break that, and a live holder
   * in another namespace looks dead. A host whose name changed makes its earlier holders look remote (`unknown`), so
   * they are judged by the TTL alone.
   */
  liveness(observer: Holder, current: Holder | undefined): HolderLiveness {
    if (this.host !== observer.host) {
      return "unknown";
    }
    if (this.bootId !== observer.bootId || current === undefined) {
      return "dead";
    }
    return current.bootId === this.bootId && current.startTime === this.startTime ? "alive" : "dead";
  }

  toSnapshot(): HolderSnapshot {
    const { host, bootId, pid, startTime } = this;
    return { host, bootId, pid, startTime };
  }
}
