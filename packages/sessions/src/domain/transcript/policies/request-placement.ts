import type { TranscriptEvent, TranscriptEventKind } from "../value-objects/transcript-event.js";

const OUTPUT_KINDS = new Set<TranscriptEventKind>(["assistant", "reasoning", "tool_call"]);

/**
 * Inserts the `request` event of an agent that logs usage after the call's output. It goes before the first model
 * output at or after `from` (else at the end), so the events before it are the call's input, and takes that
 * output's `ts`. Events from `from` on without a `requestId` join the request. Returns the start of the next
 * segment.
 */
export function placeRequest(events: TranscriptEvent[], from: number, request: TranscriptEvent): number {
  let at = events.length;
  for (let index = from; index < events.length; index++) {
    if (OUTPUT_KINDS.has(events[index]!.kind)) {
      at = index;
      break;
    }
  }
  if (at < events.length) {
    request.ts = events[at]!.ts;
  }
  events.splice(at, 0, request);
  for (let index = from; index < events.length; index++) {
    const event = events[index]!;
    if (event !== request && !event.requestId && request.requestId) {
      event.requestId = request.requestId;
    }
  }
  return events.length;
}
