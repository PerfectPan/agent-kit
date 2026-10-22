import type { TranscriptEvent, TranscriptEventKind } from "../value-objects/transcript-event.js";

/** The event kinds a model response produces; their request is placed before the first of them. */
export const OUTPUT_KINDS: ReadonlySet<TranscriptEventKind> = new Set<TranscriptEventKind>([
  "assistant",
  "reasoning",
  "tool_call"
]);

/**
 * Inserts the `request` event of an agent that logs usage after the call's output. It goes before the first model
 * output at or after `from` (else at the end), so the events before it are the call's input, and takes that
 * output's `ts`. Events from `from` on without a `requestId` join the request. Returns the start of the next
 * segment.
 */
export function placeRequest<T extends Pick<TranscriptEvent, "kind" | "ts" | "requestId">>(
  events: T[],
  from: number,
  request: T
): number {
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
