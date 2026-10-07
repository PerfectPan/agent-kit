import type { PromptSnapshotPayload, TranscriptEvent } from "../value-objects/transcript-event.js";

/** The payload of a prompt snapshot event (`system` with `type: 'prompt_snapshot'`), else `undefined`. */
export function promptSnapshot(event: TranscriptEvent): PromptSnapshotPayload | undefined {
  if (event.kind !== "system" || event.payload.type !== "prompt_snapshot") {
    return undefined;
  }
  return event.payload as unknown as PromptSnapshotPayload;
}

export function snapshotHasSystemPrompt(snapshot: PromptSnapshotPayload | undefined): boolean {
  return typeof snapshot?.systemPrompt === "string" && snapshot.systemPrompt.length > 0;
}

/** A recorded tool list, possibly empty. */
export function snapshotHasTools(snapshot: PromptSnapshotPayload | undefined): boolean {
  return Array.isArray(snapshot?.tools);
}

/** The last event in `events` whose snapshot passes `test`. */
export function latestSnapshot(
  events: readonly TranscriptEvent[],
  test: (snapshot: PromptSnapshotPayload | undefined) => boolean
): TranscriptEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (test(promptSnapshot(event))) {
      return event;
    }
  }
  return undefined;
}
