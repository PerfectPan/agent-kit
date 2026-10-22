import type { TranscriptEvent } from "../value-objects/transcript-event.js";

/**
 * Sets `shadowedBy` on the events before `compaction` on its lane that are not yet shadowed. `keep` returns true for
 * events the compaction left in the context, such as a preserved segment.
 */
export function shadowBefore(
  events: readonly TranscriptEvent[],
  compaction: TranscriptEvent,
  keep?: (event: TranscriptEvent) => boolean
): void {
  const agent = compaction.agentId ?? "";
  for (const event of events) {
    if (event === compaction) {
      break;
    }
    if ((event.agentId ?? "") !== agent || event.kind === "compaction" || event.shadowedBy) {
      continue;
    }
    if (keep?.(event)) {
      continue;
    }
    event.shadowedBy = compaction.id;
  }
}

/** Ids of the events in `events` that a compaction also in `events` removed. */
export function shadowedIn(events: readonly TranscriptEvent[]): Set<string> {
  const compactions = new Set(events.filter((event) => event.kind === "compaction").map((event) => event.id));
  const hidden = new Set<string>();
  for (const event of events) {
    if (event.shadowedBy !== undefined && compactions.has(event.shadowedBy)) {
      hidden.add(event.id);
    }
  }
  return hidden;
}
