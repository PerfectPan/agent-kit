import type { Holder, HolderLiveness } from "../value-objects/holder.js";

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
export function holderLiveness(holder: Holder, observer: Holder, current: Holder | undefined): HolderLiveness {
  if (holder.host !== observer.host) {
    return "unknown";
  }
  if (holder.bootId !== observer.bootId || current === undefined) {
    return "dead";
  }
  return current.bootId === holder.bootId && current.startTime === holder.startTime ? "alive" : "dead";
}
