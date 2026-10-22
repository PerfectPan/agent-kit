import type { TranscriptEvent } from "../value-objects/transcript-event.js";

/** Flags `orphan` on every `tool_result` with no earlier `tool_call` of the same `callId` on the same lane. */
export function markOrphanToolResults(events: readonly TranscriptEvent[]): void {
  const seen = new Set<string>();
  for (const event of events) {
    const agent = event.agentId ?? "";
    if (event.kind === "tool_call" && event.payload.callId) {
      seen.add(`${agent}\0${event.payload.callId}`);
    } else if (event.kind === "tool_result" && !seen.has(`${agent}\0${event.payload.callId}`)) {
      event.payload.orphan = true;
    }
  }
}
